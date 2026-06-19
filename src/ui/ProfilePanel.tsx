import React from 'react';
import type { Profile } from '../profile/client';

interface Props {
  profile: Profile;
  applying: boolean;
  onApply: (agentIds: string[]) => void;
  onDismiss: () => void;
}

// Card that appears when a workspace is opened: shows the detected stack and the
// recommended agent team, and lets the user prepare the project with one click.
export default function ProfilePanel({
  profile,
  applying,
  onApply,
  onDismiss,
}: Props): JSX.Element {
  // All recommended agents start selected; the user can toggle any off.
  const [selected, setSelected] = React.useState<Set<string>>(
    () => new Set(profile.agents.map((a) => a.id)),
  );

  const toggle = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const count = selected.size;

  return (
    <div className="profile-card" role="dialog" aria-label="Preparar projeto">
      <div className="profile-card__head">
        <span className="profile-card__spark">
          <i className="ti ti-sparkles" aria-hidden="true" />
        </span>
        <div className="profile-card__titles">
          <div className="profile-card__title">
            Preparar <strong>{profile.name}</strong>
          </div>
          <div className="profile-card__sub">{profile.summary}</div>
        </div>
        <button
          type="button"
          className="profile-card__x"
          onClick={onDismiss}
          title="Fechar"
          aria-label="Fechar"
        >
          <i className="ti ti-x" aria-hidden="true" />
        </button>
      </div>

      {profile.labels.length > 0 && (
        <div className="profile-card__tags">
          {profile.labels.map((l) => (
            <span key={l} className="profile-tag">
              {l}
            </span>
          ))}
        </div>
      )}

      <div className="profile-card__team">
        {profile.agents.map((a) => {
          const on = selected.has(a.id);
          return (
            <button
              key={a.id}
              type="button"
              className={`profile-agent ${on ? 'profile-agent--on' : ''}`}
              onClick={() => toggle(a.id)}
              title={a.description}
            >
              <span className="profile-agent__ic">
                <i className={`ti ${a.icon}`} aria-hidden="true" />
              </span>
              <span className="profile-agent__body">
                <span className="profile-agent__name">{a.title}</span>
                <span className="profile-agent__desc">{a.description}</span>
              </span>
              <span className="profile-agent__check">
                <i
                  className={`ti ${on ? 'ti-circle-check-filled' : 'ti-circle'}`}
                  aria-hidden="true"
                />
              </span>
            </button>
          );
        })}
      </div>

      <div className="profile-card__foot">
        <span className="profile-card__hint">
          Grava {count} agente{count === 1 ? '' : 's'} em{' '}
          <code>.claude/agents/</code> + <code>CLAUDE.md</code>
        </span>
        <div className="profile-card__actions">
          <button type="button" className="btn-ghost" onClick={onDismiss}>
            Agora não
          </button>
          <button
            type="button"
            className="btn-accent"
            disabled={applying || count === 0}
            onClick={() => onApply([...selected])}
          >
            {applying ? (
              'Preparando…'
            ) : (
              <>
                <i className="ti ti-bolt" aria-hidden="true" /> Preparar projeto
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
