import React, { useState } from 'react';
import { Zap, Eye, EyeOff } from 'lucide-react';
import { loginUser, signupUser, User } from '../lib/auth';

interface LoginProps {
  onLogin: (user: User) => void;
}

export const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [step, setStep] = useState<1 | 2>(1);
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  
  const [errorMsg, setErrorMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  const handleNext = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    if (username.trim()) {
      setStep(2);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setIsLoading(true);
    
    // We allow email or username in the "username" field for login
    const res = await loginUser(username.trim(), password);
    setIsLoading(false);
    
    if (res.success && res.user) {
      onLogin(res.user);
    } else {
      setErrorMsg(res.message || 'Erro ao fazer login.');
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    
    if (username.trim().length < 3) {
      setErrorMsg('Usuário deve ter pelo menos 3 caracteres.');
      return;
    }
    
    if (!email.includes('@')) {
      setErrorMsg('Insira um e-mail válido.');
      return;
    }
    
    if (password.length < 4) {
      setErrorMsg('Senha deve ter pelo menos 4 caracteres.');
      return;
    }

    setIsLoading(true);
    const res = await signupUser(username.trim(), email.trim(), password);
    setIsLoading(false);
    
    if (res.success) {
      setSuccessMsg(res.message || 'Cadastro realizado! Aguarde a aprovação de um Administrador.');
      setMode('login');
      setStep(1);
      setUsername('');
      setPassword('');
      setEmail('');
    } else {
      setErrorMsg(res.message || 'Erro ao criar usuário.');
    }
  };

  return (
    <div className="login-page min-h-screen flex items-center justify-center p-4">
      <div className="login-card bg-white w-full max-w-[420px] overflow-hidden">
        <div className="login-brand"><span className="brand-mark"><Zap size={23} fill="currentColor" /></span><span>ecooy</span></div>
        <p className="login-caption">Seu workspace logístico.</p>
        {/* Body */}
        <div className="p-8">
          <h2 className="text-xl text-slate-900 text-center font-semibold mb-6">
            {mode === 'login' ? 'Bem-vindo de volta' : 'Crie sua conta'}
          </h2>
          
          {errorMsg && (
            <div role="alert" className="mb-4 p-2 bg-red-50 border border-red-200 text-red-600 text-xs text-center rounded">
              {errorMsg}
            </div>
          )}
          
          {successMsg && (
            <div role="status" className="mb-4 p-2 bg-emerald-50 border border-emerald-200 text-emerald-600 text-xs text-center rounded">
              {successMsg}
            </div>
          )}

          {mode === 'login' ? (
            step === 1 ? (
              <form onSubmit={handleNext} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[13px] text-gray-600 font-medium">Usuário ou e-mail</label>
                  <input 
                    type="text"
                    aria-label="Usuário ou e-mail"
                    autoComplete="username"
                    value={username}
                    onChange={e => { setUsername(e.target.value); setErrorMsg(''); setSuccessMsg(''); }}
                    className="w-full bg-white border border-gray-300 rounded px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all outline-none"
                    autoFocus
                  />
                </div>
                <button 
                  type="submit"
                  disabled={!username.trim()}
                  className="w-full bg-[var(--ecooy-primary)] hover:bg-blue-600 disabled:bg-blue-300 text-white py-2.5 rounded text-sm font-medium transition-colors"
                >
                  Próximo
                </button>
                <div className="pt-2 text-center">
                  <button 
                    type="button" 
                    onClick={() => { setMode('signup'); setErrorMsg(''); setSuccessMsg(''); setUsername(''); setPassword(''); }}
                    className="text-[12px] text-blue-600 hover:underline"
                  >
                    Criar conta
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleLogin} className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center">
                     <label className="text-[13px] text-gray-600 font-medium">Senha</label>
                     <button 
                       type="button" 
                       onClick={() => { setStep(1); setErrorMsg(''); setSuccessMsg(''); }}
                       className="text-[11px] text-blue-600 hover:underline"
                     >
                       Trocar
                     </button>
                  </div>
                  <div className="relative">
                    <input 
                      aria-label="Senha"
                      autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={e => { setPassword(e.target.value); setErrorMsg(''); setSuccessMsg(''); }}
                      className="w-full bg-white border border-gray-300 rounded px-3 py-2 pr-10 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all outline-none"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                      className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <button 
                  type="submit"
                  disabled={!password.trim() || isLoading}
                  className="w-full bg-[var(--ecooy-primary)] hover:bg-blue-600 disabled:bg-blue-300 text-white py-2.5 rounded text-sm font-medium transition-colors flex items-center justify-center gap-2"
                >
                  {isLoading ? 'Entrando...' : 'Entrar'}
                </button>
              </form>
            )
          ) : (
            <form onSubmit={handleSignup} className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
              <div className="space-y-1.5">
                <label className="text-[13px] text-gray-600 font-medium">Usuário</label>
                <input 
                  type="text"
                  aria-label="Usuário"
                  autoComplete="username"
                  value={username}
                  onChange={e => { setUsername(e.target.value); setErrorMsg(''); setSuccessMsg(''); }}
                  className="w-full bg-white border border-gray-300 rounded px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all outline-none"
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] text-gray-600 font-medium">E-mail</label>
                <input 
                  type="email"
                  aria-label="E-mail"
                  autoComplete="email"
                  value={email}
                  onChange={e => { setEmail(e.target.value); setErrorMsg(''); setSuccessMsg(''); }}
                  className="w-full bg-white border border-gray-300 rounded px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all outline-none"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] text-gray-600 font-medium">Senha</label>
                <div className="relative">
                  <input 
                    aria-label="Senha"
                      autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                      type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={e => { setPassword(e.target.value); setErrorMsg(''); setSuccessMsg(''); }}
                    className="w-full bg-white border border-gray-300 rounded px-3 py-2 pr-10 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                    className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <button 
                type="submit"
                disabled={!username.trim() || !password.trim() || !email.trim() || isLoading}
                className="w-full bg-[var(--ecooy-primary)] hover:bg-blue-600 disabled:bg-blue-300 text-white py-2.5 rounded text-sm font-medium transition-colors"
              >
                {isLoading ? 'Criando...' : 'Criar Conta'}
              </button>
              <div className="pt-2 text-center">
                <button 
                  type="button" 
                  onClick={() => { setMode('login'); setStep(1); setErrorMsg(''); setSuccessMsg(''); setUsername(''); setPassword(''); }}
                  className="text-[12px] text-blue-600 hover:underline"
                >
                  Fazer login
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
