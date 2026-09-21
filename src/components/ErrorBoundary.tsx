import React, { Component, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

export interface ErrorBoundaryProps {
  children?: ReactNode;
  fallbackTitle?: string;
}

export interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  // @ts-ignore
  public state: ErrorBoundaryState = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  public render() {
    // @ts-ignore
    if (this.state.hasError) {
      return (
        <div className="min-h-[50vh] flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-white rounded-2xl border border-red-200 shadow-xl p-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>
            
            <div className="space-y-1">
              <h3 className="text-base font-bold text-slate-900">
                {/* @ts-ignore */}
                {this.props.fallbackTitle || 'Ocorreu um erro ao carregar esta tela'}
              </h3>
              <p className="text-xs text-slate-500">
                Uma falha inesperada foi interceptada com segurança para evitar a tela em branco.
              </p>
            </div>

            {/* @ts-ignore */}
            {this.state.error && (
              <div className="p-3 bg-red-50/80 border border-red-200 rounded-xl text-left max-h-32 overflow-y-auto">
                <p className="text-xs font-mono font-semibold text-red-800 break-words">
                  {/* @ts-ignore */}
                  {this.state.error.message || String(this.state.error)}
                </p>
              </div>
            )}

            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-colors flex items-center gap-2 cursor-pointer shadow-xs"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Recarregar Página</span>
              </button>
              <button
                onClick={() => { window.location.href = '/'; }}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-colors flex items-center gap-2 cursor-pointer"
              >
                <Home className="w-3.5 h-3.5" />
                <span>Voltar ao Início</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    // @ts-ignore
    return this.props.children;
  }
}
