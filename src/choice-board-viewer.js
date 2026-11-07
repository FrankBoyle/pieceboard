(() => {
  'use strict';
  const data = window.__CHOICES__;
  const el = (tag, className, value) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  };
  document.title = data.title;
  document.getElementById('title').textContent = data.title;
  document.getElementById('introduction').textContent = data.introduction;
  const form = document.getElementById('choices');
  const status = document.getElementById('status');
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem(data.storageKey) || '[]'); } catch { /* Answers can still be downloaded. */ }
  if (!Array.isArray(saved)) saved = [];
  const answers = data.choices.map((_, index) => ({
    selection: ['A', 'B'].includes(saved[index]?.selection) ? saved[index].selection : '',
    note: typeof saved[index]?.note === 'string' ? saved[index].note.slice(0, 1000) : '',
  }));
  const save = () => {
    try { localStorage.setItem(data.storageKey, JSON.stringify(answers)); status.textContent = 'Saved on this device. Download your answers to share them.'; }
    catch { status.textContent = 'Download your answers to keep them.'; }
  };
  data.choices.forEach((choice, index) => {
    const field = el('fieldset', 'question');
    field.append(el('legend', '', `${index + 1}. ${choice.question}`));
    if (choice.context) field.append(el('p', 'context', choice.context));
    const options = el('div', 'options');
    choice.options.forEach((option, side) => {
      const letter = side ? 'B' : 'A';
      const label = el('label', 'option');
      const radio = el('input'); radio.type = 'radio'; radio.name = `choice-${index}`; radio.value = letter; radio.checked = answers[index].selection === letter;
      const content = el('span', 'option-content');
      content.append(el('strong', '', `Choose ${letter} · ${option.label}`));
      if (option.description) content.append(el('span', 'description', option.description));
      if (option.image) { const image = el('img'); image.src = option.image; image.alt = `${option.label} example`; image.loading = 'lazy'; content.append(image); }
      else content.append(el('span', 'no-image', 'No screenshot supplied for this option.'));
      radio.addEventListener('change', () => { answers[index].selection = letter; save(); });
      label.append(radio, content); options.append(label);
    });
    const noteLabel = el('label', 'note', 'Optional note');
    const note = el('textarea'); note.rows = 2; note.maxLength = 1000; note.value = answers[index].note;
    note.addEventListener('input', () => { answers[index].note = note.value; save(); });
    noteLabel.append(note); field.append(options, noteLabel); form.append(field);
  });
  document.getElementById('download').addEventListener('click', () => {
    const lines = [`# ${data.title}`, '', `Saved: ${new Date().toISOString()}`, '', 'These answers are review input; they do not change the application.', ''];
    data.choices.forEach((choice, index) => {
      const answer = answers[index];
      const selected = answer.selection === 'A' ? choice.options[0] : answer.selection === 'B' ? choice.options[1] : null;
      lines.push(`## ${index + 1}. ${choice.question}`, '');
      if (choice.context) lines.push(`- Context: ${choice.context.replaceAll('\n', '\n  ')}`);
      lines.push(`- Choice: ${selected ? `${answer.selection} · ${selected.label}` : 'Not answered'}`);
      if (answer.note.trim()) lines.push(`- Note: ${answer.note.trim().replaceAll('\n', '\n  ')}`);
      lines.push('');
    });
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' }));
    const link = el('a'); link.href = url; link.download = 'pieceboard-choices.md'; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000); status.textContent = 'Answers downloaded. Share the file with your team.';
  });
})();
