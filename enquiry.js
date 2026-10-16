(() => {
  const dialog = document.querySelector('#route-dialog');
  const form = document.querySelector('#enquiry-form');
  const review = document.querySelector('#enquiry-review');
  const project = document.querySelector('#project-enquiry');
  const title = document.querySelector('#review-title');
  const intro = document.querySelector('#review-intro');
  const brief = document.querySelector('#brief-text');
  const status = document.querySelector('#enquiry-status');
  const copyStatus = document.querySelector('#brief-status');
  const send = document.querySelector('#send-enquiry');
  const edit = document.querySelector('#edit-brief');
  const fresh = document.querySelector('#new-enquiry');
  const fallback = document.querySelector('#enquiry-fallback');
  let state = 'editing';
  let reviewedData = null;

  function focusWhenVisible(element) {
    if (dialog.open && !project.hidden) element.focus();
  }

  function showStatus(message, kind) {
    status.textContent = message;
    status.dataset.state = kind;
    fallback.hidden = kind !== 'error';
  }

  function resetEnquiry() {
    if (state === 'sending') return;
    state = 'editing';
    reviewedData = null;
    form.reset();
    form.hidden = false;
    review.hidden = true;
    brief.textContent = '';
    copyStatus.textContent = '';
    showStatus('', 'idle');
    title.textContent = 'Your enquiry, ready to review.';
    intro.textContent = 'Check your details before sending. You can still edit or copy your brief.';
    send.textContent = 'Send enquiry';
    send.disabled = false;
    send.hidden = false;
    send.setAttribute('aria-busy', 'false');
    edit.disabled = false;
    edit.hidden = false;
    fresh.hidden = true;
  }

  document.querySelectorAll('[data-route]').forEach(button => button.addEventListener('click', () => {
    const booking = button.dataset.route === 'booking';
    document.querySelector('#route-title').textContent = booking ? 'For your next listing.' : 'Your project starts here.';
    document.querySelector('#route-eyebrow').textContent = booking ? 'REAL ESTATE MEDIA' : 'YOUR PROJECT';
    project.hidden = booking;
    document.querySelector('#listing-booking').hidden = !booking;
    dialog.querySelector('.close').setAttribute('aria-label', booking ? 'Close booking information' : 'Close enquiry');
    dialog.showModal();
    dialog.scrollTop = 0;
  }));

  form.addEventListener('submit', event => {
    event.preventDefault();
    if (state === 'sending' || state === 'sent') return;
    for (const field of form.elements) {
      if (field.name && typeof field.value === 'string') field.value = field.value.trim();
    }
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const fields = [['Name', 'name'], ['Email', 'email'], ['Company', 'company'], ['Project type', 'type'], ['Project', 'details'], ['Timing', 'timing']];
    reviewedData = Object.fromEntries(fields.map(([, name]) => [name, String(data.get(name) || '').trim()]));
    brief.textContent = fields.map(([label, name]) => `${label}: ${reviewedData[name] || 'Not provided'}`).join('\n\n');
    state = 'review';
    form.hidden = true;
    review.hidden = false;
    showStatus('', 'idle');
    copyStatus.textContent = '';
    focusWhenVisible(title);
  });

  edit.addEventListener('click', () => {
    if (state === 'sending' || state === 'sent') return;
    state = 'editing';
    reviewedData = null;
    review.hidden = true;
    form.hidden = false;
    copyStatus.textContent = '';
    showStatus('', 'idle');
    send.textContent = 'Send enquiry';
    focusWhenVisible(form.elements.namedItem('name'));
  });

  send.addEventListener('click', async () => {
    if (!reviewedData || !['review', 'error'].includes(state)) return;
    state = 'sending';
    send.disabled = true;
    edit.disabled = true;
    send.textContent = 'Sending…';
    send.setAttribute('aria-busy', 'true');
    copyStatus.textContent = '';
    showStatus('Sending your enquiry…', 'sending');

    const payload = new FormData();
    for (const [field, value] of Object.entries({
      name: reviewedData.name,
      email: reviewedData.email,
      service: reviewedData.type,
      message: reviewedData.details,
      company: reviewedData.company,
      timing: reviewedData.timing,
    })) payload.append(field, value);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    const uncertain = 'We couldn’t confirm your enquiry was sent. It may have reached Mike. Your details are still here; please check before retrying.';
    try {
      const response = await fetch(form.action, {
        method: 'POST',
        body: payload,
        headers: { Accept: 'application/json' },
        credentials: 'omit',
        redirect: 'error',
        signal: controller.signal,
      });
      if (!response.ok) {
        let message = response.status >= 500 ? uncertain : 'Your enquiry wasn’t accepted. Your details are still here. Please try again or email Mike.';
        if (response.status === 429) message = 'Too many attempts. Please wait before trying again. Your details are still here.';
        if (response.status === 400 || response.status === 422) {
          const result = await response.json().catch(() => null);
          const errors = Array.isArray(result?.errors) ? result.errors.map(error => typeof error?.message === 'string' ? error.message : '').filter(Boolean).slice(0, 3).join(' ').slice(0, 400) : '';
          message = errors ? `Please check your details: ${errors} Your draft has been kept.` : 'Please check your details and try again. Your draft has been kept.';
        }
        state = 'error';
        showStatus(message, 'error');
        focusWhenVisible(status);
        return;
      }
      state = 'sent';
      title.textContent = 'Thank you for your enquiry.';
      intro.textContent = 'Your enquiry has been accepted. Mike can reply using the email address you provided.';
      showStatus('Enquiry submitted successfully.', 'success');
      send.hidden = true;
      edit.hidden = true;
      fresh.hidden = false;
      focusWhenVisible(title);
    } catch {
      state = 'error';
      showStatus(uncertain, 'error');
      focusWhenVisible(status);
    } finally {
      clearTimeout(timer);
      send.setAttribute('aria-busy', 'false');
      send.disabled = state === 'sent';
      edit.disabled = state === 'sent';
      send.textContent = state === 'error' ? 'Retry sending' : 'Send enquiry';
    }
  });

  document.querySelector('#copy-brief').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(brief.textContent);
      copyStatus.textContent = 'Project brief copied.';
    } catch {
      copyStatus.textContent = 'Copy is unavailable here. Select the brief above to copy it manually.';
    }
  });

  fresh.addEventListener('click', () => {
    if (state !== 'sent') return;
    resetEnquiry();
    focusWhenVisible(form.elements.namedItem('name'));
  });
})();
