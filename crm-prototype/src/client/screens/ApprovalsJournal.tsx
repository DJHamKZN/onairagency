import { useEffect, useState } from 'react';
import { api } from '../api';
import { formatKop } from '../../domain/money';
import type { Approval } from '../../domain/types';
import { APPROVAL_CATEGORY_LABELS, PROPOSAL_STATUS_LABELS } from '../../domain/types';
import { Badge, Empty, ErrorBox, fmtDateTime, useApp } from '../ui';

interface Row { opportunityId: string; opportunityTitle: string; approvalId: string; proposalNumber: number | null; proposalStatus: keyof typeof PROPOSAL_STATUS_LABELS | null; approvedBy: string; approvedAt: string; status: Approval['status']; revoked: Approval['revoked']; comment: string | null; snapshotHash: string; priceKop: number | null; costKop: number | null }

export function ApprovalsJournal() {
  const { teamName, session } = useApp();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => { api.get<Row[]>('/api/approvals').then(setRows, setErr); }, [session.actingRole]);
  if (err) return <ErrorBox error={err} />;
  if (!rows) return <p>Загрузка…</p>;
  return (
    <>
      <h1>Журнал утверждений</h1>
      <p className="muted">Каждое утверждение привязано к неизменяемому снимку расчёта и условий. Снятие показывает причину и категории изменений.</p>
      {rows.length === 0 ? <Empty>Утверждений пока нет</Empty> : (
        <div className="table-wrap">
          <table className="t stack-sm">
            <thead><tr><th>Возможность</th><th>КП</th><th>Кто и когда</th><th>Цена (снимок)</th><th>Статус</th><th>Снимок</th></tr></thead>
            <tbody>{[...rows].reverse().map((r) => (
              <tr key={r.approvalId}>
                <td data-label="Возможность"><a href={`#/opp/${r.opportunityId}/proposals`}>{r.opportunityTitle}</a></td>
                <td data-label="КП">v{r.proposalNumber} · {r.proposalStatus ? PROPOSAL_STATUS_LABELS[r.proposalStatus] : ''}</td>
                <td data-label="Кто">{teamName(r.approvedBy)} (владелец)<div className="small">{fmtDateTime(r.approvedAt)}{r.comment ? ` · «${r.comment}»` : ''}</div></td>
                <td data-label="Цена">{formatKop(r.priceKop)}{r.costKop !== null && <div className="small muted">C = {formatKop(r.costKop)}</div>}</td>
                <td data-label="Статус">{r.status === 'active' ? <Badge kind="ok">Действует</Badge> : (<><Badge kind="warn">Снято {fmtDateTime(r.revoked?.at)}</Badge><div className="small">{r.revoked?.reason}</div><div className="row">{r.revoked?.categories.map((c) => <Badge key={c}>{APPROVAL_CATEGORY_LABELS[c]}</Badge>)}</div></>)}</td>
                <td data-label="Снимок" className="mono small">{r.snapshotHash.slice(0, 16)}…</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </>
  );
}
