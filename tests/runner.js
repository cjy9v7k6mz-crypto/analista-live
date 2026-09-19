/**
 * runner.js — Executor de testes mínimo, sem dependências nem build.
 *
 * A app não tem passo de build nem Node, por isso os testes correm no próprio
 * browser: abrir tests/index.html num servidor local. O resultado aparece na
 * página, no título do separador (✅/❌) e em `window.__TESTS__` (para poder
 * ser lido de forma automática).
 */

const TestRunner = {
  suites: [],
  _current: null,

  describe(name, fn) {
    const suite = { name, tests: [] };
    this.suites.push(suite);
    this._current = suite;
    fn();
    this._current = null;
  },

  it(name, fn) {
    if (!this._current) throw new Error(`it("${name}") fora de um describe`);
    this._current.tests.push({ name, fn });
  },

  async run() {
    const results = { passed: 0, failed: 0, total: 0, failures: [] };
    const out = document.getElementById('results');
    for (const suite of this.suites) {
      const rows = [];
      for (const t of suite.tests) {
        results.total++;
        try {
          await t.fn();
          results.passed++;
          rows.push(`<li class="pass">✅ ${escapeT(t.name)}</li>`);
        } catch (e) {
          results.failed++;
          results.failures.push({ suite: suite.name, test: t.name, message: e.message });
          rows.push(`<li class="fail">❌ ${escapeT(t.name)}<pre>${escapeT(e.message)}</pre></li>`);
        }
      }
      const bad = rows.some((r) => r.startsWith('<li class="fail"'));
      out.insertAdjacentHTML('beforeend',
        `<section class="${bad ? 'suite-fail' : ''}"><h2>${escapeT(suite.name)}</h2><ul>${rows.join('')}</ul></section>`);
    }
    const ok = results.failed === 0;
    document.getElementById('summary').innerHTML = ok
      ? `<strong class="ok">✅ ${results.passed}/${results.total} testes passaram</strong>`
      : `<strong class="ko">❌ ${results.failed} de ${results.total} falharam</strong>`;
    document.title = `${ok ? '✅' : '❌'} ${results.passed}/${results.total} — Testes Analista Live`;
    window.__TESTS__ = results;
    return results;
  },
};

function escapeT(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Converte Sets/Maps em estruturas comparáveis (Sets ordenados). */
function normalizeT(v) {
  if (v instanceof Set) return [...v].map(normalizeT).sort();
  if (v instanceof Map) return [...v.entries()].map(([k, x]) => [k, normalizeT(x)]).sort();
  if (Array.isArray(v)) return v.map(normalizeT);
  if (v && typeof v === 'object') {
    const o = {};
    Object.keys(v).sort().forEach((k) => { o[k] = normalizeT(v[k]); });
    return o;
  }
  return v;
}

function eq(actual, expected, label = '') {
  const a = JSON.stringify(normalizeT(actual));
  const b = JSON.stringify(normalizeT(expected));
  if (a !== b) {
    throw new Error(`${label ? label + ': ' : ''}esperado ${b}\n                    obtido  ${a}`);
  }
}

function ok(value, label = 'esperado verdadeiro') {
  if (!value) throw new Error(label);
}

window.describe = TestRunner.describe.bind(TestRunner);
window.it = TestRunner.it.bind(TestRunner);
window.eq = eq;
window.ok = ok;
window.TestRunner = TestRunner;
