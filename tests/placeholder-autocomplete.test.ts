import { describe, it, expect, beforeEach } from 'vitest';
import { attachPlaceholderAutocomplete } from '../src/popup/placeholder-autocomplete';
import { FILENAME_PLACEHOLDERS } from '../src/shared/post-process';

// Builds the field-with-popover DOM the filename-template and tags fields share,
// wires the widget, and returns handles plus the widget's own input hook.
function mount() {
  document.body.innerHTML = `
    <span class="field-with-popover">
      <input type="text" id="inp" class="field-input" />
      <div id="pop" class="placeholder-autocomplete" role="listbox" hidden></div>
    </span>`;
  const input = document.getElementById('inp') as HTMLInputElement;
  const popover = document.getElementById('pop') as HTMLDivElement;
  let selects = 0;
  const widget = attachPlaceholderAutocomplete({
    input,
    popover,
    placeholders: FILENAME_PLACEHOLDERS,
    onSelect: () => {
      selects += 1;
    },
  });
  // Mirror settings-form.ts: the input listener drives handleInput().
  input.addEventListener('input', () => widget.handleInput());
  const type = (value: string): void => {
    input.value = value;
    input.setSelectionRange(value.length, value.length);
    input.dispatchEvent(new Event('input'));
  };
  const options = (): string[] =>
    [...popover.querySelectorAll('.placeholder-autocomplete-item')].map((b) => b.textContent ?? '');
  return { input, popover, widget, type, options, selects: () => selects };
}

describe('placeholder autocomplete (filename template)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('stays closed until a `{` trigger is typed', () => {
    const { popover, type } = mount();
    type('handle');
    expect(popover.hidden).toBe(true);
  });

  it('opens with every filename placeholder when `{` is typed', () => {
    const { popover, type, options } = mount();
    type('{');
    expect(popover.hidden).toBe(false);
    expect(options()).toEqual(FILENAME_PLACEHOLDERS.map((p) => `{${p}}`));
  });

  it('filters the list by the fragment after `{`', () => {
    const { type, options } = mount();
    type('{da');
    // `date` and `datetime` both start with "da"; nothing else does.
    expect(options()).toEqual(['{date}', '{datetime}']);
  });

  it('closes once the placeholder is closed with `}`', () => {
    const { popover, type } = mount();
    type('{date}');
    expect(popover.hidden).toBe(true);
  });

  it('inserts the chosen placeholder and fires onSelect on Enter', () => {
    const { input, popover, type, selects } = mount();
    type('{ha');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(input.value).toBe('{handle}');
    expect(popover.hidden).toBe(true);
    expect(selects()).toBe(1);
  });
});
