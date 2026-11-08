(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const state = { workspace: null, projects: [], scanning: false, auth: 'none', authTimer: null, jobTimer: null };

  async function api(route, body) {
    const response = await fetch(`api/${route}`, body === undefined ? {} : {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Pieceboard could not complete that request.');
    return result;
  }
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function renderProjects(result) {
    $('project-list').replaceChildren();
    state.workspace = result;
    state.projects = [];
    $('selection-summary').textContent = 'No projects selected yet.';
    $('workspace').value = result.root;
    $('parent').disabled = result.parent === result.root;
    const count = result.projects.filter((project) => !project.root).length;
    $('project-search').value = '';
    $('project-filter').hidden = count < 5;
    $('project-status').textContent = count
      ? `Found ${count} ${count === 1 ? 'repository' : 'repositories'}. Select the ones you want to review.${count >= 3 ? ' Scroll within the list to see more.' : ''}${result.truncated ? ' The list is limited; choose a narrower folder to see more.' : ''}`
      : 'No repositories found inside this folder. You can review the folder itself or choose another folder.';
    for (const project of result.projects) {
      const box = element('div', 'project');
      const label = element('label', 'project-main');
      const checkbox = element('input');
      checkbox.type = 'checkbox';
      const text = element('span');
      const name = element('span', 'project-name', project.name);
      const meta = element('span', 'project-meta', project.root ? 'This entire folder' : 'Git repository');
      text.append(name, meta);
      label.append(checkbox, text);
      const details = element('details', 'scope');
      const summary = element('summary', '', 'Choose specific source paths (optional)');
      const paths = element('textarea');
      paths.rows = 2;
      paths.placeholder = 'src\nstyles';
      paths.setAttribute('aria-label', `Source paths within ${project.name}, one per line`);
      const help = element('p', '', 'One existing file or folder per line, relative to this project. Leave blank to scan the whole project.');
      details.append(summary, paths, help);
      box.append(label, details);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          for (const entry of state.projects) {
            if (entry.project.id !== project.id && (project.root || entry.project.root)) {
              entry.checkbox.checked = false;
              entry.box.classList.remove('selected');
            }
          }
        }
        box.classList.toggle('selected', checkbox.checked);
        const chosen = state.projects.filter((entry) => entry.checkbox.checked).length;
        $('selection-summary').textContent = chosen ? `${chosen} ${chosen === 1 ? 'project' : 'projects'} selected.` : 'No projects selected yet.';
      });
      $('project-list').append(box);
      state.projects.push({ project, checkbox, paths, box });
    }
  }
  $('project-search').addEventListener('input', () => {
    const query = $('project-search').value.trim().toLocaleLowerCase();
    for (const entry of state.projects) entry.box.hidden = !entry.project.name.toLocaleLowerCase().includes(query);
  });
  async function findProjects(folder) {
    $('find').disabled = true;
    $('scan').disabled = true;
    $('project-status').textContent = 'Finding projects…';
    try { renderProjects(await api('projects', { path: folder })); }
    catch (error) { state.workspace = null; state.projects = []; $('project-list').replaceChildren(); $('project-filter').hidden = true; $('selection-summary').textContent = 'No projects selected yet.'; $('project-status').textContent = error.message; }
    finally { $('find').disabled = false; $('scan').disabled = state.scanning; }
  }
  $('find').addEventListener('click', () => findProjects($('workspace').value.trim()));
  $('workspace').addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); findProjects($('workspace').value.trim()); } });
  $('workspace').addEventListener('input', () => {
    if (state.workspace && $('workspace').value !== state.workspace.root) {
      state.workspace = null; state.projects = []; $('project-list').replaceChildren();
      $('project-filter').hidden = true;
      $('selection-summary').textContent = 'No projects selected yet.';
      $('project-status').textContent = 'Choose Find projects to search this folder.';
    }
  });
  $('parent').addEventListener('click', () => { if (state.workspace) findProjects(state.workspace.parent); });
  $('capture').addEventListener('change', () => { $('capture-fields').hidden = !$('capture').checked; });
  $('site-scan').addEventListener('change', () => { $('site-options').hidden = !$('site-scan').checked; });

  function renderAuth(result) {
    state.auth = result.status;
    $('auth-status').textContent = result.message || '';
    $('signin').disabled = ['starting', 'waiting', 'saving'].includes(result.status);
    $('signin-finish').hidden = result.status !== 'waiting';
    $('signin-cancel').hidden = !['starting', 'waiting'].includes(result.status);
    $('use-auth-label').hidden = result.status !== 'ready';
    if (result.status !== 'ready') $('use-auth').checked = false;
  }
  async function pollAuth() {
    clearTimeout(state.authTimer);
    try {
      const result = await api('auth');
      const wasReady = state.auth === 'ready';
      renderAuth(result);
      if (result.status === 'ready' && !wasReady) $('use-auth').checked = true;
      if (['starting', 'waiting', 'saving'].includes(result.status)) state.authTimer = setTimeout(pollAuth, 800);
    } catch (error) { $('auth-status').textContent = error.message; }
  }
  $('signin').addEventListener('click', async () => {
    try { renderAuth(await api('auth/start', { page: $('page-url').value.trim() })); pollAuth(); }
    catch (error) { $('auth-status').textContent = error.message; }
  });
  $('signin-finish').addEventListener('click', async () => {
    try { renderAuth(await api('auth/finish', {})); pollAuth(); }
    catch (error) { $('auth-status').textContent = error.message; }
  });
  $('signin-cancel').addEventListener('click', async () => {
    try { renderAuth(await api('auth/cancel', {})); pollAuth(); }
    catch (error) { $('auth-status').textContent = error.message; }
  });

  async function pollJob() {
    clearTimeout(state.jobTimer);
    try {
      const result = await api('job');
      $('scan-status').textContent = result.message || '';
      if (result.partialReport) { $('partial-link').href = result.partialReport; $('partial-result').hidden = false; }
      if (result.status === 'running') { state.jobTimer = setTimeout(pollJob, 900); return; }
      state.scanning = false;
      $('scan').disabled = false;
      if (result.status === 'complete') {
        $('partial-result').hidden = true;
        $('report-link').href = result.report;
        $('report-path').textContent = `Saved locally in ${result.output}`;
        $('result').hidden = false;
      } else if (result.status === 'error') {
        $('scan-error').textContent = result.message;
        $('scan-error').hidden = false;
        $('scan-status').textContent = 'The sheet could not be created.';
      }
    } catch (error) { state.scanning = false; $('scan').disabled = false; $('scan-status').textContent = error.message; }
  }
  $('scan').addEventListener('click', async () => {
    const projects = state.projects.filter((entry) => entry.checkbox.checked).map((entry) => ({
      id: entry.project.id, paths: entry.paths.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
    }));
    $('result').hidden = true;
    $('partial-result').hidden = true;
    $('scan-error').hidden = true;
    $('scan').disabled = true;
    $('scan-status').textContent = 'Starting your review…';
    try {
      await api('scan', { projects, capture: $('capture').checked, page: $('page-url').value.trim(), site: $('capture').checked && $('site-scan').checked, siteLimit: Number($('site-limit').value), useAuth: $('capture').checked && $('use-auth').checked, focus: $('review-focus').value.trim(), searchButtonLabels: $('capture').checked && $('search-button-labels').checked });
      state.scanning = true;
      pollJob();
    } catch (error) { $('scan').disabled = false; $('scan-status').textContent = error.message; }
  });

  api('config').then((result) => findProjects(result.workspace)).catch((error) => { $('project-status').textContent = error.message; });
})();
