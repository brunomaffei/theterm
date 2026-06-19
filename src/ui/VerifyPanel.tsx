import React from 'react';
import {
  gitDiff,
  aiReviewDiff,
  guessTestCommand,
  runCheck,
  type DiffResult,
  type ReviewResult,
  type CheckResult,
  type Severity,
  type Verdict,
} from '../verify/client';

interface Props {
  path: string;
  onClose: () => void;
}

const SEV_ICON: Record<Severity, string> = {
  bug: 'ti-bug',
  risk: 'ti-alert-triangle',
  nit: 'ti-info-circle',
};

const VERDICT_META: Record<Verdict, { icon: string; label: string; cls: string }> = {
  green: { icon: 'ti-circle-check', label: 'Tudo certo', cls: 'v-green' },
  yellow: { icon: 'ti-alert-triangle', label: 'Atenção — riscos', cls: 'v-yellow' },
  red: { icon: 'ti-circle-x', label: 'Bloqueado — corrigir', cls: 'v-red' },
  none: { icon: 'ti-circle-dashed', label: 'Sem mudanças', cls: 'v-none' },
};

// Verification panel: AI review of the diff + the project's test command →
// a single green/yellow/red verdict before commit.
export default function VerifyPanel({ path, onClose }: Props): JSX.Element {
  const [diff, setDiff] = React.useState<DiffResult | null>(null);
  const [review, setReview] = React.useState<ReviewResult | null>(null);
  const [reviewing, setReviewing] = React.useState(false);
  const [reviewErr, setReviewErr] = React.useState<string | null>(null);

  const [testCmd, setTestCmd] = React.useState('');
  const [testResult, setTestResult] = React.useState<CheckResult | null>(null);
  const [testing, setTesting] = React.useState(false);

  // Load the diff summary + a guessed test command on open.
  React.useEffect(() => {
    let cancelled = false;
    gitDiff(path)
      .then((d) => !cancelled && setDiff(d))
      .catch(() => !cancelled && setDiff(null));
    guessTestCommand(path)
      .then((c) => !cancelled && setTestCmd(c))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [path]);

  const doReview = (): void => {
    setReviewing(true);
    setReviewErr(null);
    aiReviewDiff(path)
      .then((r) => setReview(r))
      .catch((e: unknown) => setReviewErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setReviewing(false));
  };

  const doTest = (): void => {
    if (!testCmd.trim()) return;
    setTesting(true);
    setTestResult(null);
    runCheck(path, testCmd)
      .then((r) => setTestResult(r))
      .catch((e: unknown) =>
        setTestResult({ passed: false, code: -1, output: e instanceof Error ? e.message : String(e), timedOut: false }),
      )
      .finally(() => setTesting(false));
  };

  // Combined verdict: a failing test forces red; otherwise the review verdict.
  const verdict: Verdict | null =
    testResult && !testResult.passed
      ? 'red'
      : review
        ? review.verdict
        : null;

  const totalChanges = diff ? diff.files.reduce((s, f) => s + f.added + f.removed, 0) : 0;

  return (
    <div className="verify-card" role="dialog" aria-label="Verificar mudanças">
      <div className="verify-card__head">
        <span className="verify-card__ic">
          <i className="ti ti-shield-check" aria-hidden="true" />
        </span>
        <div className="verify-card__titles">
          <div className="verify-card__title">Verificar mudanças</div>
          <div className="verify-card__sub">
            {diff
              ? diff.hasChanges
                ? `${diff.files.length} arquivo${diff.files.length === 1 ? '' : 's'} · ${totalChanges} linhas`
                : 'Nenhuma mudança vs último commit'
              : 'Lendo o diff…'}
          </div>
        </div>
        <button type="button" className="verify-card__x" onClick={onClose} aria-label="Fechar">
          <i className="ti ti-x" aria-hidden="true" />
        </button>
      </div>

      {verdict && (
        <div className={`verify-verdict ${VERDICT_META[verdict].cls}`}>
          <i className={`ti ${VERDICT_META[verdict].icon}`} aria-hidden="true" />
          <span>{VERDICT_META[verdict].label}</span>
        </div>
      )}

      <div className="verify-card__body">
        {/* Review section */}
        <div className="verify-section">
          <div className="verify-section__row">
            <span className="verify-section__name">Revisão de IA</span>
            <button
              type="button"
              className="btn-accent verify-btn"
              onClick={doReview}
              disabled={reviewing || (diff !== null && !diff.hasChanges)}
            >
              {reviewing ? (
                <>
                  <i className="ti ti-loader-2 spin-ic" aria-hidden="true" /> Revisando…
                </>
              ) : (
                <>
                  <i className="ti ti-eye-check" aria-hidden="true" /> Revisar diff
                </>
              )}
            </button>
          </div>
          {reviewErr && <div className="verify-err">{reviewErr}</div>}
          {review && (
            <>
              {review.summary && <div className="verify-summary">{review.summary}</div>}
              {review.findings.length === 0 ? (
                <div className="verify-clean">
                  <i className="ti ti-circle-check" aria-hidden="true" /> Nenhum problema encontrado no diff.
                </div>
              ) : (
                <div className="verify-findings">
                  {review.findings.map((f, i) => (
                    <div key={i} className={`verify-finding sev-${f.severity}`}>
                      <i className={`ti ${SEV_ICON[f.severity]} verify-finding__sev`} aria-hidden="true" />
                      <div className="verify-finding__body">
                        <div className="verify-finding__loc">
                          {f.file}
                          {f.line ? `:${f.line}` : ''}
                        </div>
                        <div className="verify-finding__issue">{f.issue}</div>
                        {f.fix && <div className="verify-finding__fix">→ {f.fix}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Test section */}
        <div className="verify-section">
          <div className="verify-section__row">
            <span className="verify-section__name">Testes</span>
            <button
              type="button"
              className="btn-ghost verify-btn"
              onClick={doTest}
              disabled={testing || !testCmd.trim()}
            >
              {testing ? (
                <>
                  <i className="ti ti-loader-2 spin-ic" aria-hidden="true" /> Rodando…
                </>
              ) : (
                <>
                  <i className="ti ti-player-play" aria-hidden="true" /> Rodar
                </>
              )}
            </button>
          </div>
          <input
            className="verify-cmd"
            value={testCmd}
            onChange={(e) => setTestCmd(e.target.value)}
            placeholder="comando de teste (ex: npm test)"
            spellCheck={false}
          />
          {testResult && (
            <div className={`verify-test ${testResult.passed ? 'ok' : 'fail'}`}>
              <div className="verify-test__head">
                <i
                  className={`ti ${testResult.passed ? 'ti-circle-check' : 'ti-circle-x'}`}
                  aria-hidden="true"
                />
                {testResult.passed
                  ? 'Testes passaram'
                  : testResult.timedOut
                    ? 'Tempo esgotado'
                    : `Falhou (código ${testResult.code})`}
              </div>
              {testResult.output && <pre className="verify-test__out">{testResult.output}</pre>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
