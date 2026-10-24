import { extractFromHtml } from './core.mjs';

let latestResult = null;
let isPro = false;

const els = {
  rawTokens: document.getElementById('rawTokens'),
  cleanTokens: document.getElementById('cleanTokens'),
  savedPct: document.getElementById('savedPct'),
  tableCount: document.getElementById('tableCount'),
  optMainContent: document.getElementById('optMainContent'),
  optIncludeLinks: document.getElementById('optIncludeLinks'),
  optFrontmatter: document.getElementById('optFrontmatter'),
  markdownOutput: document.getElementById('markdownOutput'),
  tablesOutput: document.getElementById('tablesOutput'),
  chunksOutput: document.getElementById('chunksOutput'),
  statusToast: document.getElementById('statusToast'),
  tierBadge: document.getElementById('tierBadge'),
  licenseKeyInput: document.getElementById('licenseKeyInput'),
  licenseStatus: document.getElementById('licenseStatus')
};

function showToast(msg) {
  els.statusToast.textContent = msg;
  setTimeout(() => {
    els.statusToast.textContent = 'Ready';
  }, 2400);
}

async function loadLicenseState() {
  if (!chrome?.storage?.local) return;
  const data = await chrome.storage.local.get(['markclean_pro_key']);
  if (data && data.markclean_pro_key) {
    isPro = true;
    els.tierBadge.textContent = 'PRO ACTIVE';
    els.tierBadge.classList.remove('free');
    els.tierBadge.classList.add('pro');
  }
}

async function captureAndExtract() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      els.markdownOutput.value = 'No active tab detected.';
      return;
    }

    const injection = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const selection = window.getSelection()?.toString()?.trim();
        if (selection && selection.length > 20) {
          const range = window.getSelection().getRangeAt(0);
          const container = document.createElement('div');
          container.appendChild(range.cloneContents());
          return { html: container.innerHTML, url: location.href, isSelection: true };
        }
        return { html: document.documentElement.outerHTML, url: location.href, isSelection: false };
      }
    });

    const payload = injection?.[0]?.result;
    if (!payload || !payload.html) {
      els.markdownOutput.value = 'Unable to read DOM from this page (Chrome restricted page).';
      return;
    }

    latestResult = extractFromHtml(payload.html, {
      url: payload.url,
      focusMainContent: els.optMainContent.checked,
      includeLinks: els.optIncludeLinks.checked,
      includeFrontmatter: els.optFrontmatter.checked
    });

    els.rawTokens.textContent = latestResult.stats.rawHtmlTokens.toLocaleString();
    els.cleanTokens.textContent = latestResult.stats.cleanMarkdownTokens.toLocaleString();
    els.savedPct.textContent = `-${latestResult.stats.tokenReductionPercent}%`;
    els.tableCount.textContent = String(latestResult.stats.tableCount);

    els.markdownOutput.value = latestResult.markdown;
    els.tablesOutput.value = latestResult.tables.length > 0
      ? JSON.stringify(latestResult.tables.map((t) => ({ index: t.index, headers: t.headers, rows: t.rows })), null, 2)
      : 'No HTML tables found on this page.';
    els.chunksOutput.value = JSON.stringify(latestResult.chunks, null, 2);

    showToast(payload.isSelection ? 'Extracted selection!' : 'Page extracted!');
  } catch (err) {
    els.markdownOutput.value = `Extraction error: ${err.message}`;
  }
}

// Tab switching
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.pane').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

// Option toggles re-run extraction
[els.optMainContent, els.optIncludeLinks, els.optFrontmatter].forEach((input) => {
  input.addEventListener('change', captureAndExtract);
});

// Copy actions
document.getElementById('btnCopyMarkdown').addEventListener('click', async () => {
  await navigator.clipboard.writeText(els.markdownOutput.value);
  showToast('Clean Markdown copied!');
});

document.getElementById('btnCopyPrompt').addEventListener('click', async () => {
  const promptWrapped = `Analyze the following webpage content and provide a concise, structured summary of the key facts, takeaways, and data points:\n\n<webpage_content>\n${els.markdownOutput.value}\n</webpage_content>`;
  await navigator.clipboard.writeText(promptWrapped);
  showToast('LLM Prompt + Markdown copied!');
});

document.getElementById('btnCopyTablesJson').addEventListener('click', async () => {
  await navigator.clipboard.writeText(els.tablesOutput.value);
  showToast('Tables JSON copied!');
});

document.getElementById('btnDownloadCsv').addEventListener('click', () => {
  if (!isPro) {
    document.querySelector('[data-tab="license"]').click();
    showToast('Activate Pro for CSV export');
    return;
  }
  if (!latestResult || latestResult.tables.length === 0) {
    showToast('No tables to export');
    return;
  }
  const csvContent = latestResult.tables.map((t) => t.csv).join('\n\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'markclean-tables.csv';
  a.click();
  showToast('CSV downloaded!');
});

document.getElementById('btnCopyChunks').addEventListener('click', async () => {
  if (!isPro) {
    document.querySelector('[data-tab="license"]').click();
    showToast('Activate Pro for RAG Chunks');
    return;
  }
  await navigator.clipboard.writeText(els.chunksOutput.value);
  showToast('RAG Chunks JSON copied!');
});

// Lemon Squeezy License Activation (Direct Stateless API Verification)
document.getElementById('btnActivateLicense').addEventListener('click', async () => {
  const key = els.licenseKeyInput.value.trim();
  if (!key) return;
  try {
    els.licenseStatus.textContent = 'Verifying license key...';
    const resp = await fetch('https://api.lemonsqueezy.com/v1/licenses/activate', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ license_key: key, instance_name: 'MarkClean_Chrome_Extension' })
    });
    const data = await resp.json();
    if (data && (data.activated || data.valid)) {
      await chrome.storage.local.set({ markclean_pro_key: key });
      await loadLicenseState();
      els.licenseStatus.textContent = 'Pro License activated! Thank you for your support.';
    } else {
      els.licenseStatus.textContent = data?.error || 'Invalid license key. Please check and try again.';
    }
  } catch (err) {
    els.licenseStatus.textContent = 'Network error verifying key. Please try again.';
  }
});

els.tierBadge.addEventListener('click', () => {
  document.querySelector('[data-tab="license"]').click();
});

loadLicenseState().then(captureAndExtract);
