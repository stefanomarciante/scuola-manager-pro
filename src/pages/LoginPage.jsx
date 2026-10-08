import React, { useState } from 'react';
import { login } from '../services/authService';
import logo from '../assets/logo-scuola-manager-pro.png';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
    } catch (err) {
      setError("Credenziali non valide o accesso negato.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f4f6f9] flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden">
        
        {/* Header con Logo */}
        <div className="p-8 text-center bg-white border-b border-gray-100">
          <img 
            src={logo} 
            alt="ScuolaManager Pro Logo" 
            className="w-24 h-24 mx-auto mb-4 rounded-2xl shadow-sm"
          />
          <h2 className="text-2xl font-bold text-gray-800">
            Scuola<span className="text-teal-500">Manager</span> Pro
          </h2>
          <p className="text-gray-500 text-sm mt-1 uppercase tracking-wider font-semibold">
            I.P.S.S.A.T. Rocco Chinnici
          </p>
        </div>
        
        {/* Corpo del Form */}
        <div className="p-8">
          {error && (
            <div className="bg-red-50 border-l-4 border-red-500 text-red-700 p-3 mb-6 text-sm rounded-r">
              {error}
            </div>
          )}
          
          <form onSubmit={handleLogin} className="space-y-6">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                Email Istituzionale
              </label>
              <input 
                type="email" 
                required 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 transition-all bg-gray-50 focus:bg-white"
                placeholder="prof.cognome@ipssatchinnicinicolosi.edu.it"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                Password
              </label>
              <input 
                type="password" 
                required 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 transition-all bg-gray-50 focus:bg-white"
                placeholder="••••••••"
              />
            </div>
            <div className="pt-2">
              <button 
                type="submit" 
                disabled={loading}
                className="w-full bg-[#1a365d] text-white font-bold py-3 px-4 rounded-lg hover:bg-[#12284c] transition-colors disabled:opacity-50 shadow-md"
              >
                {loading ? 'ACCESSO IN CORSO...' : 'ACCEDI'}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-8 text-sm text-gray-400 text-center font-medium">
        <p>Applicativo riservato al personale docente e amministrativo.</p>
        <p className="mt-1">&copy; {new Date().getFullYear()} IPSSAT Rocco Chinnici</p>
      </div>
    </div>
  );
}