import React, { useRef, useState } from 'react';
import { groupHybridRoutes, parseSeparacao, type SeparacaoRoute } from '../lib/separacao';

export function SeparacaoAudit({ routes, onLoad }: { routes: SeparacaoRoute[]; onLoad: (routes: SeparacaoRoute[]) => Promise<void> }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const groups = groupHybridRoutes(routes);
  return <section className="space-y-3 border border-slate-300 bg-white p-3 shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-black">Separação • rotas híbridas</h3><p className="mt-1 text-xs text-slate-500">Detalhe do roteiro → todos os IDs Otimizados com serviço hybrid, inclusive ME Extra,hybrid.</p></div>
      <label className="cursor-pointer border border-slate-300 px-3 py-2 text-xs font-black">{busy ? 'Sincronizando…' : 'Importar separação'}<input disabled={busy} type="file" className="hidden" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values" onChange={async event => {
        const file = event.currentTarget.files?.[0]; event.currentTarget.value = '';
        if (!file || busyRef.current) return;
        busyRef.current = true; setBusy(true); setError('');
        try { const buffer = await file.arrayBuffer(); let text: string; try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { text = new TextDecoder('windows-1252').decode(buffer); } await onLoad(parseSeparacao(text)); }
        catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível importar a separação.'); }
        finally { busyRef.current = false; setBusy(false); }
      }} /></label>
    </div>
    {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
    {!!routes.length && <p className="text-xs text-slate-500">{routes.length} rotas • {routes.filter(row => row.hybrid).length} híbridas • {groups.length} roteiros com híbridas</p>}
    {!!groups.length && <div className="max-h-64 overflow-auto"><table className="w-full border-collapse text-left text-xs"><thead className="sticky top-0 bg-slate-100"><tr><th className="border border-slate-200 p-2">Detalhe do roteiro</th><th className="border border-slate-200 p-2">IDs Otimizados • híbridas</th></tr></thead><tbody>{groups.map(group => <tr key={group.roteiro}><td className="border border-slate-200 p-2 font-bold">{group.roteiro}</td><td className="border border-slate-200 p-2">{group.ids.join(' • ')}</td></tr>)}</tbody></table></div>}
  </section>;
}
