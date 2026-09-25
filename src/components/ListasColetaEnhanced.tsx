import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, LocateFixed, Loader2 } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { ListasColeta } from './ListasColeta';
import type { User } from '../lib/auth';

interface ListasColetaEnhancedProps {
  currentUser?: User | null;
}

type Cycle = 'AM' | 'PM' | 'SD';

type GroupRailState = {
  panel: HTMLElement;
  scroller: HTMLDivElement;
  activeIndex: number;
  total: number;
};

const getGroupCards = (scroller: HTMLDivElement) =>
  Array.from(scroller.children).filter((node): node is HTMLElement => node instanceof HTMLElement);

const getActiveIndex = (cards: HTMLElement[]) => {
  const index = cards.findIndex(card => card.classList.contains('border-purple-600'));
  return index >= 0 ? index : 0;
};

function getAuthHeader(): Record<string, string> {
  try {
    const raw = localStorage.getItem('app_current_user');
    if (!raw) return {};
    const user = JSON.parse(raw);
    const token = user?.token || (user?.id ? `user_${user.id}` : '');
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch (_) {
    return {};
  }
}

function extractCycle(text: string | null | undefined): Cycle | null {
  const match = String(text || '').toUpperCase().match(/(?:SA[ÍI]DA\s*)?\b(AM|PM|SD)\b/);
  return match ? (match[1] as Cycle) : null;
}

function canonicalSaida(cycle: Cycle): string {
  if (cycle === 'AM') return 'Ciclo 1 - Saída AM';
  if (cycle === 'SD') return 'Ciclo 3 - Saída SD';
  return 'Ciclo 2 - Saída PM';
}

function parseHeaderDate(text: string | null | undefined): Date | null {
  const match = String(text || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) return null;
  const [, dd, mm, yyyy] = match;
  const date = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  return Number.isNaN(date.getTime()) ? null : date;
}

function isToday(date: Date | null): boolean {
  if (!date) return false;
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

export const ListasColetaEnhanced: React.FC<ListasColetaEnhancedProps> = ({ currentUser }) => {
  const params = useParams();
  const activeListaId = params.id || null;
  const [rail, setRail] = useState<GroupRailState | null>(null);
  const [headerHost, setHeaderHost] = useState<HTMLElement | null>(null);
  const [headerCycle, setHeaderCycle] = useState<Cycle | null>(null);
  const [changingCycle, setChangingCycle] = useState(false);
  const focusTimerRef = useRef<number | null>(null);
  const normalizeInFlightRef = useRef(false);
  const lastForcedNormalizeRef = useRef(0);
  const lastAutoNormalizeKeyRef = useRef('');

  const normalizeSaida = useCallback(async (
    targetCycle?: Cycle,
    options?: { force?: boolean; updateName?: boolean }
  ) => {
    if (!activeListaId || normalizeInFlightRef.current) return null;
    normalizeInFlightRef.current = true;

    try {
      const response = await fetch('/api/coleta?action=normalize-saida', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeader(),
        },
        body: JSON.stringify({
          listaId: activeListaId,
          force: options?.force === true,
          ...(targetCycle ? { targetSaida: canonicalSaida(targetCycle) } : {}),
          updateName: options?.updateName === true,
        }),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        console.warn('[Lista] Não foi possível normalizar a saída dos itens:', response.status, payload);
        return null;
      }

      return payload?.data || null;
    } catch (error) {
      console.warn('[Lista] Falha ao normalizar saída dos itens:', error);
      return null;
    } finally {
      normalizeInFlightRef.current = false;
    }
  }, [activeListaId]);

  // Descobre o cabeçalho real da lista. A correção automática só roda nas listas
  // do DIA ATUAL. Isso impede que abrir um histórico altere AM/PM/SD antigo.
  useEffect(() => {
    if (!activeListaId) {
      setHeaderHost(null);
      setHeaderCycle(null);
      return;
    }

    let disposed = false;
    let timer: number | null = null;

    const inspectHeader = () => {
      if (disposed) return;

      const candidates = Array.from(document.querySelectorAll('span'));
      const titleNode = candidates.find(node => {
        const text = node.textContent?.trim() || '';
        return /SA[ÍI]DA\s+(AM|PM|SD)/i.test(text) && /\d{1,2}\/\d{1,2}\/\d{4}/.test(text);
      });

      if (!(titleNode instanceof HTMLElement)) return;

      const text = titleNode.textContent?.trim() || '';
      const cycle = extractCycle(text);
      const date = parseHeaderDate(text);
      const host = titleNode.parentElement;

      if (host instanceof HTMLElement) setHeaderHost(host);
      if (cycle) setHeaderCycle(cycle);

      if (!cycle || !isToday(date)) return;

      const autoKey = `${activeListaId}:${cycle}`;
      if (lastAutoNormalizeKeyRef.current === autoKey) return;
      lastAutoNormalizeKeyRef.current = autoKey;

      void normalizeSaida(cycle, { force: false, updateName: false }).then(result => {
        if (!result?.metadataRepaired) return;

        // O componente principal mantém selectedSaida em estado. Recarregar uma vez
        // garante que lote/bip local também passem a usar o ciclo corrigido.
        const reloadKey = `coleta_cycle_reloaded:${activeListaId}:${cycle}`;
        try {
          if (sessionStorage.getItem(reloadKey) !== '1') {
            sessionStorage.setItem(reloadKey, '1');
            window.location.reload();
          }
        } catch (_) {}
      });
    };

    const schedule = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(inspectHeader, 180);
    };

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    schedule();

    return () => {
      disposed = true;
      observer.disconnect();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [activeListaId, normalizeSaida]);

  // Se a lista de HOJE disser SD no cabeçalho e alguma linha ainda estiver PM/AM,
  // força a correção. Listas antigas são apenas exibidas e nunca alteradas aqui.
  useEffect(() => {
    if (!activeListaId) return;

    let inspectTimer: number | null = null;

    const getOperationalInfo = () => {
      const candidates = Array.from(document.querySelectorAll('span'));
      for (const node of candidates) {
        const text = node.textContent?.trim() || '';
        if (!/SA[ÍI]DA\s+(AM|PM|SD)/i.test(text) || !/\d{1,2}\/\d{1,2}\/\d{4}/.test(text)) continue;
        const cycle = extractCycle(text);
        const date = parseHeaderDate(text);
        if (cycle) return { cycle, date };
      }
      return null;
    };

    const hasVisibleMismatch = (officialCycle: Cycle) => {
      const tables = Array.from(document.querySelectorAll('table'));
      for (const table of tables) {
        const headers = Array.from(table.querySelectorAll('thead th'));
        const saidaIndex = headers.findIndex(
          th => (th.textContent || '').trim().toUpperCase() === 'SAÍDA'
        );
        if (saidaIndex < 0) continue;

        const rows = Array.from(table.querySelectorAll('tbody tr'));
        for (const row of rows) {
          const cells = Array.from(row.querySelectorAll('td'));
          const cellCycle = extractCycle(cells[saidaIndex]?.textContent);
          if (cellCycle && cellCycle !== officialCycle) return true;
        }
      }
      return false;
    };

    const inspect = () => {
      const info = getOperationalInfo();
      if (!info || !isToday(info.date) || !hasVisibleMismatch(info.cycle)) return;

      const now = Date.now();
      if (now - lastForcedNormalizeRef.current < 2000) return;
      lastForcedNormalizeRef.current = now;
      void normalizeSaida(info.cycle, { force: true, updateName: false });
    };

    const scheduleInspect = () => {
      if (inspectTimer !== null) window.clearTimeout(inspectTimer);
      inspectTimer = window.setTimeout(inspect, 320);
    };

    const observer = new MutationObserver(scheduleInspect);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    const initialTimer = window.setTimeout(inspect, 700);

    return () => {
      observer.disconnect();
      window.clearTimeout(initialTimer);
      if (inspectTimer !== null) window.clearTimeout(inspectTimer);
    };
  }, [activeListaId, normalizeSaida]);

  const handleManualCycleChange = async (cycle: Cycle) => {
    if (!activeListaId || changingCycle || cycle === headerCycle) return;

    const confirmed = window.confirm(
      `Alterar esta lista para Saída ${cycle}? Todos os pacotes desta lista serão atualizados para o mesmo ciclo.`
    );
    if (!confirmed) return;

    setChangingCycle(true);
    try {
      const result = await normalizeSaida(cycle, { force: true, updateName: true });
      if (!result) {
        window.alert('Não foi possível alterar a saída da lista.');
        return;
      }

      setHeaderCycle(cycle);
      try {
        sessionStorage.removeItem(`coleta_cycle_reloaded:${activeListaId}:AM`);
        sessionStorage.removeItem(`coleta_cycle_reloaded:${activeListaId}:PM`);
        sessionStorage.removeItem(`coleta_cycle_reloaded:${activeListaId}:SD`);
      } catch (_) {}
      window.location.reload();
    } finally {
      setChangingCycle(false);
    }
  };

  const focusActiveGroup = useCallback((scroller?: HTMLDivElement | null, behavior: ScrollBehavior = 'smooth') => {
    if (!scroller) return;
    const cards = getGroupCards(scroller);
    if (cards.length === 0) return;

    const activeIndex = getActiveIndex(cards);
    cards[activeIndex]?.scrollIntoView({
      behavior,
      block: 'nearest',
      inline: 'center',
    });
  }, []);

  useEffect(() => {
    let observer: MutationObserver | null = null;
    let disposed = false;

    const scheduleFocus = (scroller: HTMLDivElement, behavior: ScrollBehavior = 'auto') => {
      if (focusTimerRef.current !== null) window.clearTimeout(focusTimerRef.current);
      focusTimerRef.current = window.setTimeout(() => {
        if (!disposed) focusActiveGroup(scroller, behavior);
      }, 120);
    };

    const enhanceGroups = () => {
      if (disposed) return;

      const heading = Array.from(document.querySelectorAll('h3')).find(
        node => node.textContent?.trim() === 'Grupos de Coleta'
      );
      if (!(heading instanceof HTMLElement)) {
        setRail(null);
        return;
      }

      const panel = heading.closest('div.bg-white');
      if (!(panel instanceof HTMLElement)) return;

      const scroller = Array.from(panel.querySelectorAll('div')).find(
        node => node.classList.contains('overflow-x-auto') && node.children.length > 0
      );
      if (!(scroller instanceof HTMLDivElement)) return;

      scroller.dataset.coletaGroupsRail = 'true';
      scroller.style.display = 'flex';
      scroller.style.flexDirection = 'row';
      scroller.style.flexWrap = 'nowrap';
      scroller.style.overflowX = 'auto';
      scroller.style.overflowY = 'hidden';
      scroller.style.scrollSnapType = 'x mandatory';
      scroller.style.scrollBehavior = 'smooth';
      scroller.style.gap = '12px';
      scroller.style.padding = '2px 2px 12px';
      scroller.style.alignItems = 'stretch';
      scroller.style.touchAction = 'pan-x';
      scroller.style.overscrollBehaviorX = 'contain';

      const cards = getGroupCards(scroller);
      cards.forEach(card => {
        card.style.flex = '0 0 clamp(270px, 30vw, 340px)';
        card.style.width = 'auto';
        card.style.minWidth = '270px';
        card.style.maxWidth = '340px';
        card.style.scrollSnapAlign = 'center';
        card.style.scrollSnapStop = 'always';
      });

      const activeIndex = getActiveIndex(cards);
      setRail(current => {
        if (
          current?.panel === panel &&
          current.scroller === scroller &&
          current.activeIndex === activeIndex &&
          current.total === cards.length
        ) return current;
        return { panel, scroller, activeIndex, total: cards.length };
      });

      scheduleFocus(scroller, 'auto');

      if (observer) observer.disconnect();
      observer = new MutationObserver(() => {
        const updatedCards = getGroupCards(scroller);
        updatedCards.forEach(card => {
          card.style.flex = '0 0 clamp(270px, 30vw, 340px)';
          card.style.width = 'auto';
          card.style.minWidth = '270px';
          card.style.maxWidth = '340px';
          card.style.scrollSnapAlign = 'center';
          card.style.scrollSnapStop = 'always';
        });

        const updatedActiveIndex = getActiveIndex(updatedCards);
        setRail({ panel, scroller, activeIndex: updatedActiveIndex, total: updatedCards.length });
        scheduleFocus(scroller, 'smooth');
      });

      observer.observe(scroller, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class'],
      });
    };

    const pageObserver = new MutationObserver(enhanceGroups);
    pageObserver.observe(document.body, { childList: true, subtree: true });

    enhanceGroups();
    const initialTimer = window.setTimeout(enhanceGroups, 250);

    return () => {
      disposed = true;
      pageObserver.disconnect();
      observer?.disconnect();
      window.clearTimeout(initialTimer);
      if (focusTimerRef.current !== null) window.clearTimeout(focusTimerRef.current);
    };
  }, [focusActiveGroup]);

  const scrollByCard = (direction: -1 | 1) => {
    if (!rail) return;
    const cards = getGroupCards(rail.scroller);
    if (cards.length === 0) return;

    const viewportCenter = rail.scroller.scrollLeft + rail.scroller.clientWidth / 2;
    let closestIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;

    cards.forEach((card, index) => {
      const cardCenter = card.offsetLeft + card.offsetWidth / 2;
      const distance = Math.abs(cardCenter - viewportCenter);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });

    const nextIndex = Math.max(0, Math.min(cards.length - 1, closestIndex + direction));
    cards[nextIndex]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  };

  const groupControls = rail && rail.total > 0 ? (
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-purple-100 pt-3">
      <div className="text-[11px] font-bold text-gray-500">
        Grupo atual: <span className="text-purple-700">{rail.activeIndex + 1}</span> de {rail.total}
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => scrollByCard(-1)}
          className="inline-flex h-8 items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 text-[11px] font-black text-gray-700 transition hover:border-purple-300 hover:bg-purple-50"
          title="Ver grupo anterior"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Anterior
        </button>

        <button
          type="button"
          onClick={() => focusActiveGroup(rail.scroller)}
          className="inline-flex h-8 items-center gap-1 rounded-lg border border-purple-200 bg-purple-50 px-2.5 text-[11px] font-black text-purple-700 transition hover:bg-purple-100"
          title="Centralizar o grupo ativo"
        >
          <LocateFixed className="h-3.5 w-3.5" />
          Grupo atual
        </button>

        <button
          type="button"
          onClick={() => scrollByCard(1)}
          className="inline-flex h-8 items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 text-[11px] font-black text-gray-700 transition hover:border-purple-300 hover:bg-purple-50"
          title="Ver próximo grupo"
        >
          Próximo
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  ) : null;

  const cycleControl = headerHost && headerCycle ? (
    <div className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2 py-1 shadow-sm">
      <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Saída</span>
      {changingCycle ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-[#3483FA]" />
      ) : (
        <select
          value={headerCycle}
          onChange={event => void handleManualCycleChange(event.target.value as Cycle)}
          className="bg-transparent text-[11px] font-black text-gray-700 outline-none cursor-pointer"
          title="Corrigir a saída/ciclo desta lista"
        >
          <option value="AM">AM</option>
          <option value="PM">PM</option>
          <option value="SD">SD</option>
        </select>
      )}
    </div>
  ) : null;

  return (
    <>
      <ListasColeta currentUser={currentUser} />
      {rail && groupControls ? createPortal(groupControls, rail.panel) : null}
      {headerHost && cycleControl ? createPortal(cycleControl, headerHost) : null}
    </>
  );
};
