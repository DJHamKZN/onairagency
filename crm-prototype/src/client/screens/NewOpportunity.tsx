import { useEffect, useState } from 'react';
import { api } from '../api';
import type { PromiseCategory } from '../../domain/types';
import { Check, ErrorBox, Field, Select, useAction, useApp } from '../ui';

/** Минимум для нового запроса: компания/название, запрос, обещания или «не зафиксированы», ответственный, следующий шаг. */
export function NewOpportunity() {
  const { session, team } = useApp();
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [newCompany, setNewCompany] = useState('');
  const [title, setTitle] = useState('');
  const [request, setRequest] = useState('');
  const [noPromises, setNoPromises] = useState(true);
  const [promise, setPromise] = useState('');
  const [category, setCategory] = useState<PromiseCategory>('other');
  const [owner, setOwner] = useState(session.user.id);
  const [pm, setPm] = useState(session.actingRole === 'presale_pm' ? session.user.id : '');
  const [stepText, setStepText] = useState('');
  const [stepWho, setStepWho] = useState(session.user.id);
  const [stepDue, setStepDue] = useState('');
  const a = useAction();
  useEffect(() => { api.get<{ id: string; name: string }[]>('/api/companies').then(setCompanies); }, []);

  const missingField = (label: string) => (a.error as { missing?: string[] } | null)?.missing?.some((m) => m.includes(label)) ? 'Обязательное поле' : null;

  return (
    <section className="card" style={{ maxWidth: 760 }}>
      <h1>Новый запрос</h1>
      <p className="muted">Бюджет, бриф и аудит не нужны для создания. Их можно собрать позже, по мере работы.</p>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void a.run(async () => {
            let cid = companyId;
            if (!cid && newCompany.trim()) cid = (await api.post<{ id: string }>('/api/companies', { name: newCompany })).id;
            const v = await api.post<{ id: string }>('/api/opportunities', {
              title: title || newCompany || companies.find((c) => c.id === cid)?.name || '',
              companyId: cid,
              originalRequest: request,
              promisesNotRecorded: noPromises,
              promises: noPromises ? [] : [{ what: promise, category, byRole: session.roleLabels[session.actingRole] }],
              ownerUserId: owner,
              presalePmUserId: pm || null,
              nextStep: { text: stepText, assigneeUserId: stepWho, due: stepDue },
            });
            window.location.hash = `#/opp/${v.id}`;
          });
        }}
      >
        <div className="grid two">
          <Select label="Компания" value={companyId} onChange={setCompanyId} placeholder="— новая компания —" options={companies.map((c) => [c.id, c.name])} error={missingField('Компания')} />
          {!companyId && <Field label="Название новой компании" value={newCompany} onChange={setNewCompany} hint="Только вымышленные названия" />}
        </div>
        <Field label="Короткое название возможности" value={title} onChange={setTitle} hint="Если пусто — будет название компании" />
        <Field label="Исходный запрос (словами клиента)" multiline value={request} onChange={setRequest} required error={missingField('Исходный запрос')} />
        <fieldset className="card" style={{ margin: 0 }}>
          <legend><strong>Обещания агентства</strong></legend>
          <Check label="Обещания не зафиксированы" checked={noPromises} onChange={setNoPromises} />
          {!noPromises && (
            <div className="grid two" style={{ marginTop: 8 }}>
              <Field label="Что обещано" value={promise} onChange={setPromise} required />
              <Select label="Тип" value={category} onChange={setCategory} options={[['result', 'Результат'], ['price', 'Цена'], ['deadline', 'Срок'], ['discount', 'Скидка'], ['free_work', 'Бесплатная работа'], ['other', 'Другое']]} />
            </div>
          )}
          {missingField('Обещания') && <div className="field-error">Укажите обещание или отметьте «не зафиксированы»</div>}
        </fieldset>
        <div className="grid two">
          <Select label="Ответственный" value={owner} onChange={setOwner} options={team.map((t) => [t.id, t.displayName])} required />
          <Select label="Проджект пресейла" value={pm} onChange={setPm} placeholder="не назначен" options={team.filter((t) => t.roles.includes('presale_pm')).map((t) => [t.id, t.displayName])} />
        </div>
        <fieldset className="card" style={{ margin: 0 }}>
          <legend><strong>Следующий шаг</strong></legend>
          <div className="grid three">
            <Field label="Что сделать" value={stepText} onChange={setStepText} required error={missingField('Следующий шаг')} />
            <Select label="Кто" value={stepWho} onChange={setStepWho} options={team.map((t) => [t.id, t.displayName])} required />
            <Field label="Срок" type="date" value={stepDue} onChange={setStepDue} required error={missingField('Срок следующего шага')} />
          </div>
        </fieldset>
        <ErrorBox error={a.error} />
        <div className="row"><button className="btn primary" disabled={a.busy}>Создать запрос</button><a className="btn" href="#/opps">Отмена</a></div>
      </form>
    </section>
  );
}
