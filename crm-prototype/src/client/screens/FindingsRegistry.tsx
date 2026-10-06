import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { AuditFinding, ClaimType, Verification } from '../../domain/types';
import { CLAIM_TYPE_LABELS, MODULE_LABELS, VERIFICATION_LABELS } from '../../domain/types';
import { Badge, Empty, ErrorBox, Select, useApp } from '../ui';

interface Row { opportunityId: string; opportunityTitle: string; finding: AuditFinding; exportReadiness: { ready: boolean; reason: string } }

export function FindingsRegistry() {
  const { session } = useApp();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [ver, setVer] = useState<'' | Verification>('');
  const [claim, setClaim] = useState<'' | ClaimType>('');
  const [ready, setReady] = useState<'' | 'yes' | 'no'>('');
  useEffect(() => { api.get<Row[]>('/api/findings').then(setRows, setErr); }, [session.actingRole]);
  const list = useMemo(() => (rows ?? []).filter((r) =>
    (!ver || r.finding.verification === ver) && (!claim || r.finding.claimType === claim) && (!ready || (ready === 'yes') === r.exportReadiness.ready)), [rows, ver, claim, ready]);
  if (err) return <ErrorBox error={err} />;
  if (!rows) return <p>Загрузка…</p>;
  return (
    <>
      <h1>Реестр находок</h1>
      <p className="muted">Готовность к клиентскому экспорту определяется проверкой доказательства, а не наличием ссылки или заполненного поля.</p>
      <section className="card grid three" aria-label="Фильтры">
        <Select label="Проверка доказательства" value={ver} onChange={setVer} placeholder="Любая" options={Object.entries(VERIFICATION_LABELS) as [Verification, string][]} />
        <Select label="Тип утверждения" value={claim} onChange={setClaim} placeholder="Любой" options={Object.entries(CLAIM_TYPE_LABELS) as [ClaimType, string][]} />
        <Select label="Клиентский экспорт" value={ready} onChange={setReady} placeholder="Неважно" options={[['yes', 'Готово'], ['no', 'Не готово']]} />
      </section>
      {list.length === 0 ? <Empty>Нет находок по выбранным фильтрам</Empty> : (
        <div className="table-wrap">
          <table className="t stack-sm">
            <thead><tr><th>Код</th><th>Находка</th><th>Возможность</th><th>Тип</th><th>Проверка</th><th>Экспорт клиенту</th></tr></thead>
            <tbody>{list.map((r) => (
              <tr key={r.finding.id}>
                <td data-label="Код" className="mono">{r.finding.code}</td>
                <td data-label="Находка">{r.finding.title}<div className="small muted">{MODULE_LABELS[r.finding.module]}</div></td>
                <td data-label="Возможность"><a href={`#/opp/${r.opportunityId}/diagnostics`}>{r.opportunityTitle}</a></td>
                <td data-label="Тип">{CLAIM_TYPE_LABELS[r.finding.claimType]}</td>
                <td data-label="Проверка"><Badge kind={r.finding.verification === 'supported' ? 'ok' : 'warn'}>{VERIFICATION_LABELS[r.finding.verification]}</Badge></td>
                <td data-label="Экспорт">{r.exportReadiness.ready ? <Badge kind="ok">Готово</Badge> : <Badge kind="warn">Не готово</Badge>}<div className="small">{r.exportReadiness.reason}</div></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </>
  );
}
