// Reusable `{placeholder}` autocomplete for template inputs: typing `{` opens a
// filtered list of placeholder names; Arrow keys move, Enter/Tab confirm, Escape
// dismisses, and a click or confirm inserts `{name}` at the trigger position.
//
// Used by the Obsidian tags-template field. Kept generic (input + placeholder
// list + onSelect) so the filename-template field can adopt it without a second
// copy of this logic.

interface AutocompleteState {
  triggerStart: number; // index of the `{` in the input
  highlighted: number; // index of the currently highlighted option
  items: readonly string[]; // placeholders without braces
}

export interface PlaceholderAutocomplete {
  // Call from the input's own `input` listener (after your preview update).
  handleInput(): void;
  // Force the popover shut — call from blur / reset.
  close(): void;
}

export function attachPlaceholderAutocomplete(opts: {
  input: HTMLInputElement;
  popover: HTMLElement;
  placeholders: readonly string[];
  // Fired after a choice is inserted into the input — caller persists / previews.
  onSelect: () => void;
}): PlaceholderAutocomplete {
  const { input, popover, placeholders, onSelect } = opts;
  let state: AutocompleteState | null = null;

  function close(): void {
    state = null;
    popover.hidden = true;
    popover.replaceChildren();
  }

  function render(items: readonly string[], highlighted: number): void {
    popover.replaceChildren(
      ...items.map((name, i) => {
        const opt = document.createElement('button');
        opt.type = 'button';
        opt.className = 'placeholder-autocomplete-item' + (i === highlighted ? ' highlighted' : '');
        opt.textContent = `{${name}}`;
        opt.addEventListener('mousedown', (e) => {
          // mousedown (not click) so the input's blur doesn't race with selection
          e.preventDefault();
          apply(i);
        });
        return opt;
      })
    );
    popover.hidden = false;
  }

  function handleInput(): void {
    const caret = input.selectionStart ?? input.value.length;
    // Walk back from the caret to the most recent `{` not yet closed.
    const head = input.value.slice(0, caret);
    const open = head.lastIndexOf('{');
    if (open < 0) {
      close();
      return;
    }
    const fragment = head.slice(open + 1);
    // A `}` between the `{` and the caret means the placeholder is already
    // closed; the next `{` (if any) will open a new context on a later keystroke.
    if (fragment.includes('}')) {
      close();
      return;
    }
    const filtered = placeholders.filter((p) => p.startsWith(fragment));
    if (filtered.length === 0) {
      close();
      return;
    }
    state = { triggerStart: open, highlighted: 0, items: filtered };
    render(filtered, 0);
  }

  function apply(index: number): void {
    if (!state) return;
    const choice = state.items[index];
    if (!choice) return;
    const value = input.value;
    const caret = input.selectionStart ?? value.length;
    const before = value.slice(0, state.triggerStart);
    const after = value.slice(caret);
    const insertion = `{${choice}}`;
    input.value = before + insertion + after;
    const newCaret = before.length + insertion.length;
    input.setSelectionRange(newCaret, newCaret);
    close();
    onSelect();
    input.focus();
  }

  input.addEventListener('keydown', (e) => {
    if (!state) return;
    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        const next = (state.highlighted + 1) % state.items.length;
        state.highlighted = next;
        render(state.items, next);
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        const len = state.items.length;
        const next = (state.highlighted - 1 + len) % len;
        state.highlighted = next;
        render(state.items, next);
        break;
      }
      case 'Enter':
      case 'Tab':
        e.preventDefault();
        apply(state.highlighted);
        break;
      case 'Escape':
        e.preventDefault();
        close();
        break;
    }
  });

  return { handleInput, close };
}
