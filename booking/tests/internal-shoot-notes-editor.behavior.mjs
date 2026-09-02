import assert from "node:assert/strict";
import test, { after } from "node:test";

import React from "react";
import TestRenderer, { act } from "react-test-renderer";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const originalConsoleError = console.error;
console.error = (...args) => {
  if (
    typeof args[0] === "string" &&
    args[0].startsWith("react-test-renderer is deprecated")
  ) {
    return;
  }
  originalConsoleError(...args);
};
after(() => {
  console.error = originalConsoleError;
});

async function loadView() {
  const imported = await import(
    "../app/admin/internal-shoot-notes/InternalShootNotesEditorView.tsx"
  );
  const loaded = imported.default ?? imported;
  assert.equal(typeof loaded.InternalShootNotesEditorView, "function");
  return loaded.InternalShootNotesEditorView;
}

function createDraftStore() {
  const entries = new Map();
  return {
    entries,
    load(key) {
      return entries.get(key) ?? null;
    },
    save(key, value) {
      entries.set(key, value);
    },
    clear(key) {
      entries.delete(key);
    },
  };
}

function button(root, label) {
  const found = root
    .findAllByType("button")
    .find((node) => node.children.join("").includes(label));
  assert.ok(found, `missing button ${label}`);
  return found;
}

function text(root) {
  return root.findAllByType("p").map((node) => node.children.join("")).join("\n");
}

test("editor persists a dirty SPA draft and restores it after remount", async () => {
  const View = await loadView();
  const draftStore = createDraftStore();
  const props = {
    bookingId: "booking-1",
    draftScope: "admin-1",
    initialNotes: null,
    initialRevision: 0,
    saveAction: async () => ({ ok: true, notes: null, revision: 1 }),
    refreshAction() {},
    draftStore,
  };
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(View, props));
  });
  await act(async () => button(renderer.root, "Add note").props.onClick());
  await act(async () => {
    renderer.root.findByType("textarea").props.onChange({
      target: { value: "Bring the tall tripod." },
    });
  });
  assert.equal(draftStore.entries.size, 1);
  await act(async () => renderer.unmount());

  await act(async () => {
    renderer = TestRenderer.create(React.createElement(View, props));
  });
  assert.equal(renderer.root.findByType("textarea").props.value, "Bring the tall tripod.");
  assert.match(text(renderer.root), /restored/i);
});

test("pending save disables controls, commits a revision, clears the draft, and restores focus", async () => {
  const View = await loadView();
  const draftStore = createDraftStore();
  let resolveSave;
  const calls = [];
  const saveAction = (...args) => {
    calls.push(args);
    return new Promise((resolve) => {
      resolveSave = resolve;
    });
  };
  let focusCount = 0;
  let refreshCount = 0;
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(View, {
        bookingId: "booking-2",
        draftScope: "admin-1",
        initialNotes: "Old",
        initialRevision: 4,
        saveAction,
        refreshAction() {
          refreshCount += 1;
        },
        draftStore,
      }),
      {
        createNodeMock(element) {
          if (element.type === "button") {
            return { focus() { focusCount += 1; } };
          }
          return {};
        },
      },
    );
  });
  await act(async () => button(renderer.root, "Edit").props.onClick());
  await act(async () => {
    renderer.root.findByType("textarea").props.onChange({ target: { value: "New" } });
  });
  await act(async () => button(renderer.root, "Save note").props.onClick());
  assert.deepEqual(calls, [["booking-2", "New", 4]]);
  assert.equal(renderer.root.findByType("textarea").props.disabled, true);
  assert.equal(button(renderer.root, "Cancel").props.disabled, true);

  await act(async () => {
    resolveSave({ ok: true, notes: "New", revision: 5 });
  });
  assert.equal(button(renderer.root, "Edit").children.join(""), "Edit");
  assert.equal(draftStore.entries.size, 0);
  assert.equal(refreshCount, 1);
  assert.equal(focusCount, 1);
  assert.match(text(renderer.root), /saved/i);
});

test("same-booking prop drift and server conflicts preserve the draft and require an explicit overwrite", async () => {
  const View = await loadView();
  const draftStore = createDraftStore();
  const calls = [];
  const saveAction = async (...args) => {
    calls.push(args);
    return {
      ok: false,
      conflict: true,
      error: "This private shoot note changed elsewhere.",
      notes: "Newest",
      revision: 3,
    };
  };
  let renderer;
  const baseProps = {
    bookingId: "booking-3",
    draftScope: "admin-1",
    initialNotes: "First",
    initialRevision: 1,
    saveAction,
    refreshAction() {},
    draftStore,
  };
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(View, baseProps));
  });
  await act(async () => button(renderer.root, "Edit").props.onClick());
  await act(async () => {
    renderer.root.findByType("textarea").props.onChange({ target: { value: "My draft" } });
  });
  await act(async () => {
    renderer.update(
      React.createElement(View, {
        ...baseProps,
        initialNotes: "Remote",
        initialRevision: 2,
      }),
    );
  });
  assert.equal(renderer.root.findByType("textarea").props.value, "My draft");
  assert.match(text(renderer.root), /changed elsewhere/i);
  assert.ok(button(renderer.root, "Overwrite with my draft"));
  assert.equal([...draftStore.entries.values()][0].baseRevision, 1);

  await act(async () => button(renderer.root, "Overwrite with my draft").props.onClick());
  assert.deepEqual(calls, [["booking-3", "My draft", 2]]);
  assert.equal(renderer.root.findByType("textarea").props.value, "My draft");
  assert.match(text(renderer.root), /Newest/);
  assert.ok(button(renderer.root, "Overwrite with my draft"));
  assert.equal([...draftStore.entries.values()][0].baseRevision, 1);

  await act(async () => renderer.unmount());
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(View, {
        ...baseProps,
        initialNotes: "Newest",
        initialRevision: 3,
      }),
    );
  });
  assert.equal(renderer.root.findByType("textarea").props.value, "My draft");
  assert.match(text(renderer.root), /changed elsewhere/i);
  assert.match(text(renderer.root), /Newest/);
  assert.ok(button(renderer.root, "Overwrite with my draft"));
});

test("failed and conflicted saves restore focus to the private-note editor", async () => {
  const View = await loadView();
  const draftStore = createDraftStore();
  let mode = "failed";
  let focusCount = 0;
  let renderer;
  const props = {
    bookingId: "booking-focus",
    draftScope: "admin-1",
    initialNotes: "Original",
    initialRevision: 1,
    async saveAction() {
      if (mode === "conflict") {
        return {
          ok: false,
          conflict: true,
          error: "This private shoot note changed elsewhere.",
          notes: "Newest",
          revision: 2,
        };
      }
      return { ok: false, error: "Could not save the private shoot note." };
    },
    refreshAction() {},
    draftStore,
  };
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(View, props), {
      createNodeMock(element) {
        if (element.type === "textarea") {
          return { focus() { focusCount += 1; } };
        }
        return {};
      },
    });
  });
  await act(async () => button(renderer.root, "Edit").props.onClick());
  await act(async () => {
    renderer.root.findByType("textarea").props.onChange({ target: { value: "Draft" } });
  });
  await act(async () => button(renderer.root, "Save note").props.onClick());
  assert.equal(focusCount, 1);

  mode = "conflict";
  await act(async () => button(renderer.root, "Save note").props.onClick());
  assert.equal(focusCount, 2);
  assert.ok(button(renderer.root, "Overwrite with my draft"));
});

test("cancel clears the persisted draft, restores focus, and rendered notes wrap long tokens", async () => {
  const View = await loadView();
  const draftStore = createDraftStore();
  let focusCount = 0;
  let renderer;
  const props = {
    bookingId: "booking-4",
    draftScope: "admin-1",
    initialNotes: "x".repeat(2000),
    initialRevision: 8,
    saveAction: async () => ({ ok: true, notes: null, revision: 9 }),
    refreshAction() {},
    draftStore,
  };
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(View, props), {
      createNodeMock(element) {
        if (element.type === "button") return { focus() { focusCount += 1; } };
        return {};
      },
    });
  });
  const renderedNote = renderer.root
    .findAllByType("p")
    .find((node) => node.children.join("") === "x".repeat(2000));
  assert.ok(renderedNote.props.className.includes("overflow-wrap:anywhere"));
  assert.ok(button(renderer.root, "Edit").props.className.includes("min-h-11"));

  await act(async () => button(renderer.root, "Edit").props.onClick());
  await act(async () => {
    renderer.root.findByType("textarea").props.onChange({ target: { value: "dirty" } });
  });
  await act(async () => button(renderer.root, "Cancel").props.onClick());
  assert.equal(draftStore.entries.size, 0);
  assert.equal(focusCount, 1);
  assert.ok(button(renderer.root, "Edit"));
});
