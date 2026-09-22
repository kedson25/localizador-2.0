import React, { useState, useEffect } from 'react';
import { Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { CsvRow, GroupSummary } from './types';
import { parseCsvText } from './utils/csvParser';
import { ToolsHub } from './components/ToolsHub';
import { IdLookup } from './components/IdLookup';
import { IdRemover } from './components/IdRemover';
import { WhatsappReport } from './components/WhatsappReport';
import { CsvUploader } from './components/CsvUploader';
import { StatsSummary } from './components/StatsSummary';
import { ControleRefugo } from './components/ControleRefugo';
import { ListasColeta } from './components/ListasColeta';
import { ListasDashboard } from './components/ListasDashboard';
import { BrancasPanelWithCsvFallback } from './components/BrancasPanelWithCsvFallback';
import { Login } from './components/Login';
import { Navigate } from 'react-router-dom';
import { AdminPanel } from './components/AdminPanel';
import { User, getCurrentUser } from './lib/auth';
import { ErrorBoundary } from './components/ErrorBoundary';

import { saveToColetor, loadFromColetor, clearColetor } from './lib/firebase';

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const isHome = location.pathname === '/';

  const [rawText, setRawText] = useState<string>('');
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [notification, setNotification] = useState<string | null>(null);
  const [loadingFirebase, setLoadingFirebase] = useState<boolean>(true);
  const [currentUser, setCurrentUser] = useState<User | null>(() => getCurrentUser());
  const isAuthenticated = !!currentUser;

  useEffect(() => {
    if (currentUser) {
      const tabName = location.pathname.startsWith('/refugo') ? 'Refugo' :
                      location.pathname.startsWith('/brancas') ? 'Brancas' :
                      location.pathname.startsWith('/listas') ? 'Coleta (Listas)' :
                      location.pathname.startsWith('/consulta') ? 'Consulta' :
                      location.pathname.startsWith('/remover') ? 'Remover' :
                      location.pathname.startsWith('/reporte') ? 'Reporte' :
                      location.pathname.startsWith('/admin') ? 'Admin' : 'Hub / Início';
      
      try {
        const activePresences = JSON.parse(localStorage.getItem('app_active_presences') || '{}');
        activePresences[currentUser.id || currentUser.username] = {
          username: currentUser.username,
          tab: tabName,
          lastActive: Date.now()
        };
        localStorage.setItem('app_active_presences', JSON.stringify(activePresences));
      } catch {}
    }
  }, [location.pathname, currentUser]);

  const showNotification = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 4000);
  };

  // On mount, load stored CSV from Firebase Firestore for the Hub
  useEffect(() => {
    let isMounted = true;
    async function initFromFirebase() {
      try {
        const savedData = await loadFromColetor();
        if (isMounted && savedData && savedData.rawText) {
          setRawText(savedData.rawText);
          const parsed = parseCsvText(savedData.rawText);
          setRows(parsed.rows);
          setGroups(parsed.groups);
          setHeaders(parsed.headers);
        }
      } catch (err) {
        console.error('Erro ao carregar dados:', err);
      } finally {
        if (isMounted) {
          setLoadingFirebase(false);
        }
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

    // Save to Firebase
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
    
    // Clear from Firebase
    await clearColetor();
    showNotification('Dados zerados com sucesso!');
  };

  const getPageTitle = () => {
    switch (location.pathname) {
      case '/consulta': return 'Buscar grupos';
      case '/remover': return 'Remover IDs';
      case '/reporte': return 'Reporte WhatsApp';
      case '/upload': return 'Importar CSV';
      case '/listas': return 'Listas de Coleta';
      case '/refugo': return 'Controle Refugo';
      case '/brancas': return 'Análise de Brancas';
      case '/admin': return 'Painel Admin';
      default: return '';
    }
  };

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-[#EBEBEB] text-[#333333] flex flex-col font-sans selection:bg-[#3483FA] selection:text-white">
      {/* Main Content Area */}
      <main className={`flex-1 w-full min-w-0 mx-auto ${location.pathname === "/login" ? "" : location.pathname === "/listas" ? "px-3 sm:px-6 py-4 sm:py-6 space-y-4" : "max-w-7xl px-3 sm:px-6 lg:px-8 py-4 sm:py-6 space-y-4"}`}>
        {/* Floating Notification */}
        {notification && (
          <div className="bg-[#111827] text-white px-3.5 py-2.5 rounded-lg shadow-md text-xs font-mono flex items-center justify-between border border-gray-700 animate-in fade-in max-w-full">
            <span className="flex items-center gap-2 min-w-0 break-words pr-2">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse shrink-0"></span>
              <span className="break-words">{notification}</span>
            </span>
            <button
              onClick={() => setNotification(null)}
              className="ml-2 hover:text-gray-300 font-bold px-2 py-1 min-h-[36px] min-w-[36px] flex items-center justify-center shrink-0 cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        <ErrorBoundary>
          {isAuthenticated && location.pathname !== '/' && location.pathname !== '/login' && !location.pathname.startsWith('/listas/') && (
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-3 sm:mb-4">
              <button
                onClick={() => navigate('/')}
                className="flex items-center gap-2 px-3.5 py-2 sm:py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-bold text-gray-700 hover:bg-gray-50 transition-colors shadow-sm cursor-pointer min-h-[40px] sm:min-h-0"
              >
                <ArrowLeft className="w-4 h-4 text-[#3483FA]" />
                <span>Voltar para o Hub</span>
              </button>
              {getPageTitle() && (
                <>
                  <div className="h-4 w-px bg-gray-300 mx-1 hidden sm:block"></div>
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                    {getPageTitle()}
                  </span>
                </>
              )}
            </div>
          )}

          <Routes>
            {/* Public Routes */}
            <Route path="/refugo" element={<ControleRefugo currentUser={currentUser} />} />
            <Route path="/login" element={
              isAuthenticated ? <Navigate to="/" replace /> : <Login onLogin={(user) => { setCurrentUser(user); navigate('/'); }} />
            } />
            
            {/* Protected Routes */}
            {isAuthenticated && (
              <>
                <Route path="/" element={<ToolsHub totalRows={rows.length} groups={groups} onClear={handleClear} currentUser={currentUser} />} />
                
                {currentUser?.isAdmin && (
                  <Route path="/admin" element={<AdminPanel currentUser={currentUser} />} />
                )}

                {(currentUser?.isAdmin || currentUser?.allowedGroups?.includes('consulta')) && (
                  <Route path="/consulta" element={<><StatsSummary totalRows={rows.length} groups={groups} /><IdLookup rows={rows} onNavigateToUpload={() => navigate('/upload')} /></>} />
                )}

                {(currentUser?.isAdmin || currentUser?.allowedGroups?.includes('remover')) && (
                  <Route path="/remover" element={<IdRemover rows={rows} headers={headers} />} />
                )}

                {(currentUser?.isAdmin || currentUser?.allowedGroups?.includes('reporte')) && (
                  <Route path="/reporte" element={<WhatsappReport rows={rows} />} />
                )}

                {(currentUser?.isAdmin || currentUser?.allowedGroups?.includes('listas')) && (
                  <>
                    <Route path="/listas" element={<ListasDashboard currentUser={currentUser} />} />
                    <Route path="/listas/:id" element={<ListasColeta currentUser={currentUser} />} />
                  </>
                )}

                {(currentUser?.isAdmin || currentUser?.allowedGroups?.includes('upload')) && (
                  <Route path="/upload" element={<CsvUploader onLoadText={(text) => { handleParseAndSave(text); navigate('/'); }} currentTotalRows={rows.length} />} />
                )}

                <Route path="/brancas" element={<BrancasPanelWithCsvFallback currentUser={currentUser} />} />
              </>
            )}
            
            {/* Fallback */}
            <Route path="*" element={isAuthenticated ? <Navigate to="/" replace /> : <Navigate to="/login" replace />} />
          </Routes>
        </ErrorBoundary>
      </main>
    </div>
  );
}
