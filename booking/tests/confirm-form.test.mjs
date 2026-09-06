import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { load, root } from './public-inbox-proof.test.mjs';
import { resolve } from 'node:path';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
test('confirmation exposes persistent associated errors and focuses summary; verification retains sensitive draft in memory', async () => {
  let result = { ok: false, errors: { contact_phone: 'Required.', contact_name: 'Required.', contact_email: 'Required.', password: 'At least 8 characters.' } };
  let focused = 0;
  const Form = load(resolve(root,'app/book/confirm/ConfirmForm.tsx'), {
    react: { ...React, useActionState: () => [result, () => {}] },
    'react-dom': { useFormStatus: () => ({ pending: false }) },
    'next/link': { default: 'a' },
    '../actions': { createPublicBooking() {} },
    '../_components/BookingTotalBar': { default: () => null },
  }).default;
  const props = { requestId: 'retained-request', profile: null, items: [], state: {services: [], addOns: [], shotRequests: [], shootNotes: 'private shoot instructions', streetAddress: '1 Fictional', unitNumber: '', city: '', postalCode: '', squareFootage: null, slot: ''} };
  let view;
  await act(async () => { view=Renderer.create(React.createElement(Form,props), {createNodeMock: el => el.props.role==='alert' ? {focus() { focused++; }} : {}}); });
  assert.equal(view.root.findByType('form').props.noValidate,true);
  assert.equal(focused,1);
  assert.ok(view.root.findByProps({role:'alert'}));
  for (const name of Object.keys(result.errors)) {
    const input=view.root.findAllByType('input').find(n=>n.props.name===name);
    assert.equal(input.props['aria-invalid'],true);
    const message=view.root.findByProps({id:input.props['aria-describedby']});
    assert.equal(message.children.join(''),result.errors[name]);
  }
  const password=view.root.findAllByType('input').find(n=>n.props.name==='password');
  await act(async()=>password.props.onChange({currentTarget:{value:'memory-only-password'}}));
  await act(async()=>view.root.findByType('textarea').props.onChange({currentTarget:{value:'private gate code'}}));
  result={ok:false,verificationRequired:true};
  await act(async()=>view.update(React.createElement(Form,props)));
  const inputs=view.root.findAllByType('input');
  assert.equal(inputs.find(n=>n.props.name==='password').props.value,'memory-only-password');
  assert.equal(view.root.findByType('textarea').props.value,'private gate code');
  assert.equal(inputs.find(n=>n.props.name==='verification_code').props.autoComplete,'one-time-code');
  assert.equal(inputs.find(n=>n.props.name==='shoot_notes').props.value,'private shoot instructions');
  assert.equal(inputs.find(n=>n.props.name==='public_request_id').props.value,'retained-request');
  await act(async()=>view.unmount());
});
