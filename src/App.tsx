import React, { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { CsvRow, GroupSummary } from './types';
import { parseCsvText } from './utils/csvParser';
import { ToolsHub } from './components/ToolsHub';
import { DashboardShell } from './components/DashboardShell';
import { IdLookup } from './components/IdLookup';
import { CorrelacaoIds } from './components/CorrelacaoIds';
import { IdRemover } from './components/IdRemover';
import { WhatsappReportEnhanced } from './components/WhatsappReportEnhanced';
import { CsvUploader } from './components/CsvUploader';
import { StatsSummary } from './components/StatsSummary';
import { ControleRefugoClean } from './components/ControleRefugoClean';
import { ListasColetaEnhanced } from './components/ListasColetaEnhanced';
import { ListasDashboard } from './components/ListasDashboard';
import { BrancasPanelWithCsvFallback } from './components/BrancasPanelWithCsvFallback';
import { SettingsPage } from './components/SettingsPage';
import { Login } from './components/Login';
import { AdminPanel } from './components/AdminPanel';
import { OperationNavigation } from './components/OperationNavigation';
import { User, getCurrentUser } from './lib/auth';
import { ErrorBoundary } from './components/ErrorBoundary';
import { saveToColetor, loadFromColetor, clearColetor } from './lib/firebase';

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();

  const [rawText, setRawText] = useState<string>('');
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [notification, setNotification] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(() => getCurrentUser());
  const isAuthenticated = !!currentUser;

  useEffect(() => {
    if (currentUser) {
      const tabName = location.pathname.startsWith('/refugo') ? 'Refugo' :
                      location.pathname.startsWith('/brancas') ? 'Brancas' :
                      location.pathname.startsWith('/listas') ? 'Coleta (Listas)' :
                      location.pathname.startsWith('/consulta') ? 'Consulta' :
                      location.pathname.startsWith('/correlacao') ? 'Correlação' :
                      location.pathname.startsWith('/remover') ? 'Remover' :
                      location.pathname.startsWith('/reporte') ? 'Reporte' :
                      location.pathname.startsWith('/configuracoes') ? 'Configurações' :
                      location.pathname.startsWith('/admin') ? 'Admin' : 'Módulos';

      try {
        const activePresences = JSON.parse(localStorage.getItem('app_active_presences') || '{}');
        activePresences[currentUser.id || currentUser.username] = {
          username: currentUser.username,
          tab: tabName,
          lastActive: Date.now(),
        };
        localStorage.setItem('app_active_presences', JSON.stringify(activePresences));
      } catch {}
    }
  }, [location.pathname, currentUser]);

  const showNotification = (msg: string) => {
    setNotification(msg);
    window.setTimeout(() => setNotification(null), 4000);
  };

  useEffect(() => {
    let isMounted = true;

    async function initFromFirebase() {
      try {
        const savedData = await loadFromColetor();
        if (isMounted && savedData?.rawText) {
          setRawText(savedData.rawText);
          const parsed = parseCsvText(savedData.rawText);
          setRows(parsed.rows);
          setGroups(parsed.groups);
          setHeaders(parsed.headers);
        }
      } catch (err) {
        console.error('Erro ao carregar dados:', err);
      }
    }

    initFromFirebase();
    return () => {
      isMounted = false;
    };
  }, []);

  const handleParseAndSave = async (textToParse: string, fileName?: string) => {
    setRawText(textToParse);
    const parsed = parseCsvText(textToParse);
    setRows(parsed.rows);
    setGroups(parsed.groups);
    setHeaders(parsed.headers);

    const saved = await saveToColetor(textToParse, parsed.rows.length, fileName);
    if (saved) {
      showNotification(`Dados processados e salvos com sucesso! (${parsed.rows.length} IDs)`);
    } else {
      showNotification('Processado localmente.');
    }
  };

  const handleClear = async () => {
    setRawText('');
    setRows([]);
    setGroups([]);
    setHeaders([]);
    navigate('/');
    await clearColetor();
    showNotification('Dados zerados com sucesso!');
  };

  const insideDashboard = (content: React.ReactNode) => (
    <DashboardShell currentUser={currentUser}>
      {content}
    </DashboardShell>
  );

  const dedicatedOperation = (content: React.ReactNode) => (
    <div className="min-h-screen bg-[#EBEBEB] text-[#333333]">
      <OperationNavigation />
      <main className="mx-auto w-full max-w-7xl space-y-4 px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
        {content}
      </main>
    </div>
  );

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-[#EBEBEB] font-sans text-[#333333] selection:bg-[#3483FA] selection:text-white">
      {notification && (
        <div className="fixed left-1/2 top-4 z-[100] flex w-[min(92vw,720px)] -translate-x-1/2 items-center justify-between rounded-lg border border-gray-700 bg-[#111827] px-3.5 py-2.5 text-xs text-white shadow-xl">
          <span className="flex min-w-0 items-center gap-2 pr-2">
            <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-amber-400" />
            <span className="break-words">{notification}</span>
          </span>
          <button
            type="button"
            onClick={() => setNotification(null)}
            className="ml-2 flex min-h-[36px] min-w-[36px] shrink-0 items-center justify-center px-2 py-1 font-bold hover:text-gray-300"
          >
            ✕
          </button>
        </div>
      )}

      <ErrorBoundary>
        <Routes>
          <Route
            path="/login"
            element={
              isAuthenticated
                ? <Navigate to="/" replace />
                : <Login onLogin={(user) => { setCurrentUser(user); navigate('/'); }} />
            }
          />

          {/* Telas operacionais dedicadas: navegação compacta própria. */}
          <Route
            path="/refugo"
            element={dedicatedOperation(<ControleRefugoClean currentUser={currentUser} />)}
          />

          {isAuthenticated && (
            <>
              {/* Módulos é a única página inicial do sistema. */}
              <Route
                path="/"
                element={
                  <ToolsHub
                    totalRows={rows.length}
                    groups={groups}
                    onClear={handleClear}
                    currentUser={currentUser}
                  />
                }
              />

              <Route
                path="/configuracoes"
                element={insideDashboard(<SettingsPage currentUser={currentUser} />)}
              />

              {currentUser?.isAdmin && (
                <Route
                  path="/admin"
                  element={insideDashboard(<AdminPanel currentUser={currentUser} />)}
                />
              )}

              {(currentUser?.isAdmin || currentUser?.allowedGroups?.includes('consulta')) && (
                <Route
                  path="/consulta"
                  element={insideDashboard(
                    <div className="space-y-4">
                      <StatsSummary totalRows={rows.length} groups={groups} />
                      <IdLookup rows={rows} onNavigateToUpload={() => navigate('/upload')} />
                    </div>
                  )}
                />
              )}

              <Route
                path="/correlacao"
                element={insideDashboard(<CorrelacaoIds />)}
              />

              {(currentUser?.isAdmin || currentUser?.allowedGroups?.includes('remover')) && (
                <Route
                  path="/remover"
                  element={insideDashboard(<IdRemover rows={rows} headers={headers} />)}
                />
              )}

              {(currentUser?.isAdmin || currentUser?.allowedGroups?.includes('reporte')) && (
                <Route
                  path="/reporte"
                  element={insideDashboard(<WhatsappReportEnhanced rows={rows} />)}
                />
              )}

              {(currentUser?.isAdmin || currentUser?.allowedGroups?.includes('listas')) && (
                <>
                  <Route
                    path="/listas"
                    element={insideDashboard(<ListasDashboard currentUser={currentUser} />)}
                  />
                  <Route
                    path="/listas/:id"
                    element={dedicatedOperation(<ListasColetaEnhanced currentUser={currentUser} />)}
                  />
                </>
              )}

              {(currentUser?.isAdmin || currentUser?.allowedGroups?.includes('upload')) && (
                <Route
                  path="/upload"
                  element={insideDashboard(
                    <CsvUploader
                      onLoadText={(text) => {
                        handleParseAndSave(text);
                        navigate('/');
                      }}
                      currentTotalRows={rows.length}
                    />
                  )}
                />
              )}

              <Route
                path="/brancas"
                element={insideDashboard(<BrancasPanelWithCsvFallback currentUser={currentUser} />)}
              />
            </>
          )}

          <Route
            path="*"
            element={isAuthenticated ? <Navigate to="/" replace /> : <Navigate to="/login" replace />}
          />
        </Routes>
      </ErrorBoundary>
    </div>
  );
}
