/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ChevronRight, 
  ArrowRight, 
  BarChart2, 
  Target, 
  Zap, 
  Wallet, 
  Heart, 
  Smile, 
  Compass,
  AlertCircle,
  Loader2,
  CheckCircle2
} from 'lucide-react';
import { GoogleGenAI, Type } from "@google/genai";
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import { 
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer 
} from 'recharts';

// --- Types ---
type Area = 'Financeiro' | 'Relacionamento' | 'Emocional' | 'Clareza de Vida';

interface Question {
  id: string;
  text: string;
  options: {
    text: string;
    area?: Area; // Used in primary questions to identify the dominant area
    score: number;
  }[];
}

interface QuizState {
  step: 'home' | 'quiz' | 'result_simple' | 'registration' | 'payment' | 'result_full';
  currentQuestionIndex: number;
  answers: Record<string, number>;
  areaScores: Record<Area, number>;
  identifiedArea: Area | null;
  tieBreakerArea: Area | null; // Tracks choice of P4 for tie-breaking
  openAnswer: string;
  analysis: {
    intensity: string;
    time: string;
  } | null;
  report: {
    leituraDireta: string;
    oQueEstaAcontecendo: string;
    erroPrincipal: string;
    consequencia: string;
    planoDesbloqueio: string[];
    ajusteDirecao: string;
    fraseFinal: string;
  } | null;
  loadingReport: boolean;
  userData: {
    name: string;
    email: string;
  };
  resultId: string | null;
  openAnswerError: string | null;
  registrationError: string | null;
  openAnswerCharCount: number;
}

// --- Analysis Keywords ---
const EMOTIONAL_KEYWORDS = ['ansiedade', 'ansioso', 'medo', 'angústia', 'sobrecarga', 'cansado', 'cansada', 'exausto', 'exausta', 'tristeza'];
const FINANCEIRO_KEYWORDS = ['dinheiro', 'dívida', 'contas', 'renda', 'salário', 'trabalho', 'pagar', 'falta de dinheiro'];
const RELACIONAMENTO_KEYWORDS = ['sozinho', 'sozinha', 'abandono', 'rejeição', 'ciúme', 'briga', 'traição', 'relacionamento', 'marido', 'esposa', 'namorado', 'namorada'];
const CLAREZA_KEYWORDS = ['perdido', 'perdida', 'sem rumo', 'sem direção', 'dúvida', 'indeciso', 'indecisa', 'não sei', 'travado', 'travada'];

const INTENSITY_ALTA = ['muito', 'demais', 'não aguento', 'insuportável', 'sempre', 'urgente'];
const INTENSITY_MEDIA = ['às vezes', 'frequentemente', 'difícil', 'complicado'];
const INTENSITY_BAIXA = ['pouco', 'leve', 'raramente'];

const TIME_CURTO = ['hoje', 'essa semana', 'há dias'];
const TIME_MEDIO = ['há algumas semanas', 'há um mês'];
const TIME_LONGO = ['há meses', 'faz meses', 'há anos', 'faz anos', 'muito tempo'];

// --- Firebase ---
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

// --- Data ---
const PRIMARY_QUESTIONS: Question[] = [
  {
    id: 'p1',
    text: 'Se você pudesse destravar apenas UMA destas situações hoje, qual seria?',
    options: [
      { text: 'O dinheiro entra, mas não permanece ou cresce', area: 'Financeiro', score: 1 },
      { text: 'Me entrego mais do que recebo nas minhas relações', area: 'Relacionamento', score: 1 },
      { text: 'Minha mente não desacelera nem para descansar', area: 'Emocional', score: 1 },
      { text: 'Estou sempre ocupado, mas sem clareza de direção', area: 'Clareza de Vida', score: 1 },
    ]
  },
  {
    id: 'p2',
    text: 'Onde você sente que sua energia está sendo mais desperdiçada?',
    options: [
      { text: 'Tentando equilibrar contas e boletos', area: 'Financeiro', score: 1 },
      { text: 'Lidando com conflitos ou silêncios pesados', area: 'Relacionamento', score: 1 },
      { text: 'Lutando contra pensamentos que não calam', area: 'Emocional', score: 1 },
      { text: 'Fazendo muito, mas sem sair do lugar', area: 'Clareza de Vida', score: 1 },
    ]
  },
  {
    id: 'p3',
    text: 'Qual destes sentimentos mais te acompanha ao final do dia?',
    options: [
      { text: 'Escassez: sinto que nunca será o suficiente', area: 'Financeiro', score: 1 },
      { text: 'Solidão: mesmo acompanhado, me sinto só', area: 'Relacionamento', score: 1 },
      { text: 'Exaustão: minha mente está fritando', area: 'Emocional', score: 1 },
      { text: 'Vazio: sinto que estou apenas sobrevivendo', area: 'Clareza de Vida', score: 1 },
    ]
  },
  {
    id: 'p4',
    text: 'Se a sua vida fosse um filme hoje, o título seria:',
    options: [
      { text: 'A Corrida Contra os Números', area: 'Financeiro', score: 1 },
      { text: 'O Labirinto das Expectativas Alheias', area: 'Relacionamento', score: 1 },
      { text: 'A Mente que Jamais Dorme', area: 'Emocional', score: 1 },
      { text: 'A Estrada Sem Placas de Destino', area: 'Clareza de Vida', score: 1 },
    ]
  }
];

const SECONDARY_QUESTIONS_MAP: Record<Area, Question[]> = {
  'Financeiro': [
    { id: 'f1', text: 'Você evita olhar a conta bancária por medo do que vai encontrar?', options: [{ text: 'Sim', score: 10 }, { text: 'Às vezes', score: 6 }, { text: 'Não', score: 2 }] },
    { id: 'f2', text: 'Você sente que o dinheiro entra, mas não permanece ou cresce?', options: [{ text: 'Exatamente isso', score: 10 }, { text: 'Um pouco', score: 6 }, { text: 'Não', score: 2 }] },
    { id: 'f3', text: 'Você sente culpa quando gasta algo com você mesmo?', options: [{ text: 'Sim', score: 10 }, { text: 'Às vezes', score: 6 }, { text: 'Não', score: 2 }] },
    { id: 'f4', text: 'Você sente que trabalha apenas para pagar boletos?', options: [{ text: 'Sim', score: 10 }, { text: 'Em parte', score: 6 }, { text: 'Não', score: 2 }] },
    { id: 'f5', text: 'Sua situação financeira te impede de dormir tranquilo?', options: [{ text: 'Sim', score: 10 }, { text: 'Algumas noites', score: 6 }, { text: 'Não', score: 2 }] },
    { id: 'f6', text: 'Você sente que está sempre "apagando incêndios" financeiros?', options: [{ text: 'Sim', score: 10 }, { text: 'Com frequência', score: 8 }, { text: 'Não', score: 2 }] },
  ],
  'Relacionamento': [
    { id: 'r1', text: 'Você sente que se entrega mais do que recebe nas suas relações?', options: [{ text: 'Sim, sempre', score: 10 }, { text: 'Às vezes', score: 6 }, { text: 'Não', score: 2 }] },
    { id: 'r2', text: 'Você evita dizer o que pensa para não gerar conflito?', options: [{ text: 'Sim', score: 10 }, { text: 'Em parte', score: 6 }, { text: 'Não', score: 2 }] },
    { id: 'r3', text: 'Você se sente responsável pela felicidade da outra pessoa?', options: [{ text: 'Sim', score: 10 }, { text: 'Um pouco', score: 6 }, { text: 'Não', score: 2 }] },
    { id: 'r4', text: 'Você sente que perdeu sua identidade dentro de uma relação?', options: [{ text: 'Sim', score: 10 }, { text: 'Talvez', score: 6 }, { text: 'Não', score: 2 }] },
    { id: 'r5', text: 'Você tem dificuldade em colocar limites claros para os outros?', options: [{ text: 'Muita', score: 10 }, { text: 'Alguma', score: 6 }, { text: 'Não', score: 2 }] },
    { id: 'r6', text: 'Você sente que está mendigando atenção ou carinho?', options: [{ text: 'Sim', score: 10 }, { text: 'Às vezes', score: 6 }, { text: 'Não', score: 2 }] },
  ],
  'Emocional': [
    { id: 'e1', text: 'Você sente que sua mente não desacelera, mesmo quando tenta descansar?', options: [{ text: 'Sim, o tempo todo', score: 10 }, { text: 'Às vezes', score: 6 }, { text: 'Não', score: 2 }] },
    { id: 'e2', text: 'Você sente um aperto no peito sem motivo aparente?', options: [{ text: 'Sim', score: 10 }, { text: 'Às vezes', score: 6 }, { text: 'Não', score: 2 }] },
    { id: 'e3', text: 'Você se cobra excessivamente por coisas pequenas?', options: [{ text: 'Sim', score: 10 }, { text: 'Às vezes', score: 6 }, { text: 'Não', score: 2 }] },
    { id: 'e4', text: 'Você sente que está sempre "no modo de sobrevivência"?', options: [{ text: 'Sim', score: 10 }, { text: 'Em parte', score: 6 }, { text: 'Não', score: 2 }] },
    { id: 'e5', text: 'Sua paciência anda mais curta do que o normal?', options: [{ text: 'Sim', score: 10 }, { text: 'Às vezes', score: 6 }, { text: 'Não', score: 2 }] },
    { id: 'e6', text: 'Você sente que suas emoções estão no controle da sua vida?', options: [{ text: 'Sim', score: 10 }, { text: 'Às vezes', score: 6 }, { text: 'Não', score: 2 }] },
  ],
  'Clareza de Vida': [
    { id: 'c1', text: 'Você sente que está ocupado, mas sem clareza de para onde está indo?', options: [{ text: 'Exatamente isso', score: 10 }, { text: 'Às vezes', score: 6 }, { text: 'Não', score: 2 }] },
    { id: 'c2', text: 'Você sente que o tempo está passando e você continua no mesmo lugar?', options: [{ text: 'Sim', score: 10 }, { text: 'Em parte', score: 6 }, { text: 'Não', score: 2 }] },
    { id: 'c3', text: 'Você tem dificuldade em dizer "não" para distrações?', options: [{ text: 'Muita', score: 10 }, { text: 'Alguma', score: 6 }, { text: 'Não', score: 2 }] },
    { id: 'c4', text: 'Você sente que não tem um propósito claro para seus dias?', options: [{ text: 'Sim', score: 10 }, { text: 'Às vezes', score: 6 }, { text: 'Não', score: 2 }] },
    { id: 'c5', text: 'Você sente desmotivação ao pensar no seu futuro?', options: [{ text: 'Sim', score: 10 }, { text: 'Às vezes', score: 6 }, { text: 'Não', score: 2 }] },
    { id: 'c6', text: 'Você sente que está vivendo a vida no "automático"?', options: [{ text: 'Sim', score: 10 }, { text: 'Em parte', score: 6 }, { text: 'Não', score: 2 }] },
  ]
};

const RESULTS_CONTENT: Record<Area, { action: string }> = {
  'Financeiro': {
    action: 'Hoje, anote tudo o que entra e tudo o que sai. Clareza financeira começa quando você para de fugir dos números.'
  },
  'Relacionamento': {
    action: 'Hoje, pare de engolir tudo em silêncio. Identifique uma conversa que precisa acontecer e escreva o que você realmente sente.'
  },
  'Emocional': {
    action: 'Hoje, pare por 10 minutos e tire da mente o que está te sufocando. Escreva tudo em um papel e escolha apenas uma prioridade.'
  },
  'Clareza de Vida': {
    action: 'Hoje, pare de tentar decidir tudo de uma vez. Escolha uma única direção para os próximos 7 dias e elimine o restante por enquanto.'
  }
};

// --- Views ---

const HomeView = ({ onStart }: { onStart: () => void }) => (
  <div className="flex flex-col items-center justify-center min-h-screen text-center px-6 py-12">
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-2xl space-y-12"
    >
      <div className="space-y-6">
        <div className="inline-flex items-center justify-center p-4 mb-2 bg-brand-card rounded-2xl text-brand-gold shadow-sm border border-brand-border">
          <AlertCircle size={40} strokeWidth={1.5} />
        </div>
        <h1 className="text-4xl md:text-5xl font-extrabold text-brand-gold tracking-tight leading-tight text-balance">
          Em poucos minutos, descubra o que está <span className="text-brand-gold-soft italic underline decoration-brand-gold-soft/30 decoration-4 underline-offset-8">travando sua vida hoje</span>.
        </h1>
        <p className="text-lg md:text-xl text-brand-muted font-medium leading-relaxed max-w-lg mx-auto">
          Responda algumas perguntas rápidas e veja qual área está bloqueando seus resultados — e o que você pode fazer ainda hoje para mudar isso.
        </p>
      </div>

      <div className="flex flex-col items-center gap-8">
        <span className="px-5 py-2 bg-brand-card border border-brand-border rounded-full text-[10px] font-black uppercase tracking-[0.2em] text-brand-muted shadow-xs">
          ⏱ Leva menos de 2 minutos
        </span>

        <div className="bg-brand-card p-8 rounded-[12px] border border-brand-border shadow-md text-left w-full max-w-md space-y-6">
          <p className="text-xs font-black uppercase tracking-[0.15em] text-brand-muted mb-4 px-2">Você vai sair com:</p>
          <ul className="space-y-4">
             <li className="flex items-start gap-4 text-brand-text font-semibold leading-tight px-2">
               <div className="w-2 h-2 bg-brand-gold rounded-full mt-1.5 shrink-0"></div>
               <span>Clareza sobre o que está te travando</span>
             </li>
             <li className="flex items-start gap-4 text-brand-text font-semibold leading-tight px-2">
               <div className="w-2 h-2 bg-brand-gold rounded-full mt-1.5 shrink-0"></div>
               <span>Um direcionamento imediato</span>
             </li>
             <li className="flex items-start gap-4 text-brand-text font-semibold leading-tight px-2">
               <div className="w-2 h-2 bg-brand-gold rounded-full mt-1.5 shrink-0"></div>
               <span>Um plano simples para começar hoje</span>
             </li>
          </ul>
        </div>
      </div>

      <button 
        id="btn-start"
        onClick={onStart}
        className="group relative inline-flex items-center justify-center px-14 py-6 text-xl font-bold text-brand-bg transition-all duration-300 bg-brand-gold rounded-[8px] hover:bg-brand-gold-soft active:scale-95 shadow-xl shadow-brand-gold/10 cursor-pointer uppercase tracking-tight"
      >
        Quero descobrir agora
        <ArrowRight className="ml-3 w-6 h-6 group-hover:translate-x-1 transition-transform" />
      </button>
    </motion.div>
  </div>
);

const QuizView = ({ 
  state, 
  progress, 
  currentQuestions, 
  openAnswerRef, 
  onAnswer, 
  onFinalSubmit, 
  onCharCountUpdate 
}: { 
  state: QuizState; 
  progress: number;
  currentQuestions: Question[];
  openAnswerRef: React.RefObject<HTMLTextAreaElement>;
  onAnswer: (score: number, area?: Area) => void;
  onFinalSubmit: () => void;
  onCharCountUpdate: (count: number) => void;
}) => {
  const isPrimary = state.currentQuestionIndex < 4;
  const isOpen = state.currentQuestionIndex === 10;
  const currentQuestion = isOpen ? null : currentQuestions[state.currentQuestionIndex];

  return (
    <div className="flex flex-col min-h-screen">
      <div className="w-full h-1 bg-brand-border sticky top-0 z-20">
        <motion.div 
          className="h-full bg-brand-gold"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
        />
      </div>

      <div className="flex-1 flex flex-col justify-center max-w-xl mx-auto w-full px-6 py-12">
        <AnimatePresence mode="wait">
          {isOpen ? (
            <motion.div 
              key="open-question"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-10"
            >
              <div className="space-y-4">
                <span className="inline-block px-3 py-1 bg-brand-gold/10 text-brand-gold rounded-lg text-[10px] font-black uppercase tracking-widest">
                  Última Etapa
                </span>
                <h2 className="text-2xl md:text-3xl font-bold text-brand-text leading-tight">
                  Descreva em poucas palavras o que mais está te incomodando hoje e há quanto tempo isso acontece.
                </h2>
              </div>
              
              <div className="relative group">
                <textarea
                  id="input-open"
                  ref={openAnswerRef}
                  defaultValue={state.openAnswer}
                  onChange={(e) => onCharCountUpdate(e.target.value.length)}
                  className={`w-full h-48 p-6 bg-brand-card border-2 rounded-[12px] focus:outline-none transition-all text-lg shadow-sm ${state.openAnswerError ? 'border-red-500 bg-red-500/10' : 'border-brand-border focus:border-brand-gold'}`}
                  placeholder="Sua resposta é fundamental para o diagnóstico final..."
                />
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest px-1">
                   <span className={state.openAnswerCharCount >= 50 ? 'text-green-500' : 'text-brand-muted'}>
                      Log: {state.openAnswerCharCount} / 50 caracteres
                   </span>
                   {state.openAnswerCharCount >= 50 && (
                      <span className="text-green-500 flex items-center gap-1.5 font-black">
                        <CheckCircle2 size={14} /> Entrada validada
                      </span>
                   )}
                </div>
              </div>

              {state.openAnswerError && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="p-5 bg-red-500/10 text-red-400 rounded-2xl flex items-start gap-3 border border-red-500/20"
                >
                  <AlertCircle className="shrink-0 mt-0.5" size={20} />
                  <p className="font-semibold text-sm leading-relaxed">{state.openAnswerError}</p>
                </motion.div>
              )}
              
              <button
                id="btn-finish"
                onClick={onFinalSubmit}
                className="w-full py-6 bg-brand-gold text-brand-bg rounded-[8px] font-bold text-xl hover:bg-brand-gold-soft active:scale-95 flex items-center justify-center group shadow-xl shadow-brand-gold/10 transition-all uppercase tracking-tight"
              >
                Ver Resultado
                <ArrowRight className="ml-3 group-hover:translate-x-1 transition-transform" />
              </button>
            </motion.div>
          ) : currentQuestion ? (
            <motion.div 
              key={currentQuestion.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-10"
            >
              <div className="space-y-4">
                <span className="inline-block px-3 py-1 bg-brand-gold/10 text-brand-gold rounded-lg text-[10px] font-black uppercase tracking-widest">
                  {isPrimary ? 'Identificando seu Perfil' : `Análise: ${state.identifiedArea}`}
                </span>
                <h2 className="text-2xl md:text-3xl font-bold text-brand-gold leading-tight">
                  {currentQuestion.text}
                </h2>
              </div>

              <div className="grid gap-4">
                {currentQuestion.options.map((option, idx) => (
                  <button
                    key={idx}
                    onClick={() => onAnswer(option.score, option.area)}
                    className="text-left p-6 bg-brand-card border border-brand-border rounded-[12px] hover:border-brand-gold hover:bg-brand-gold/5 transition-all group flex items-center justify-between shadow-sm active:scale-[0.98]"
                  >
                    <span className="text-lg text-brand-text font-medium leading-snug pr-4">{option.text}</span>
                    <ChevronRight className="text-brand-muted group-hover:text-brand-gold group-hover:translate-x-1 transition-all" />
                  </button>
                ))}
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
};

const ResultSimpleView = ({ state, content, chartData, onGoToPayment }: { state: QuizState; content: any; chartData: any[]; onGoToPayment: () => void }) => {
  const dominantArea = state.identifiedArea as Area;
  const firstName = state.userData.name.split(' ')[0] || "Você";

  const areaDescriptionMap: Record<Area, string> = {
    'Financeiro': 'revela uma relação de insegurança com o futuro e uma necessidade latente de controle que você ainda não conseguiu estabelecer.',
    'Relacionamento': 'aponta para um padrão de autossabotagem e carência que tem drenado sua energia vital nas últimas semanas.',
    'Emocional': 'mostra uma sobrecarga interna invisível, onde sua mente não descansa mais e o ruído mental impedem sua paz.',
    'Clareza de Vida': 'indica um travamento por excesso de possibilidades e uma falta de decisão que está mantendo sua vida em modo de espera.'
  };

  return (
    <div className="min-h-screen py-12 px-6 bg-gradient-to-b from-[#0F0F10] to-[#1C1C1F]">
      <div className="max-w-3xl mx-auto space-y-14">
        <div className="text-center space-y-6">
          <h1 className="text-3xl md:text-5xl font-black text-brand-gold leading-tight text-balance">
            {firstName}, o que você respondeu revela mais do que você imagina.
          </h1>
          <p className="text-xl text-brand-muted font-medium leading-relaxed max-w-2xl mx-auto">
            Seu resultado não é superficial, {firstName}. Ele aponta um padrão que está afetando sua vida agora.
          </p>
          <div className="h-0.5 w-32 bg-brand-gold/40 mx-auto rounded-full"></div>
        </div>

        <div className="bg-brand-card rounded-[12px] p-10 md:p-14 border border-brand-border shadow-xl relative overflow-hidden">
          <div className="grid md:grid-cols-2 gap-16 items-center relative z-10">
            <div className="space-y-10">
              <div className="space-y-3">
                <p className="text-brand-gold text-[10px] font-black uppercase tracking-[0.3em]">Ponto Sensível Hoje</p>
                <h2 className="text-4xl font-extrabold text-brand-text italic leading-tight">Hoje, o ponto mais sensível da sua vida está em: <span className="text-brand-gold">{dominantArea}</span></h2>
              </div>

              <div className="space-y-5 pt-8 border-t border-brand-border">
                <p className="text-lg text-brand-muted leading-relaxed font-medium">
                   O que você escreveu <span className="text-brand-gold-soft italic">{areaDescriptionMap[dominantArea]}</span>
                </p>
              </div>
            </div>

            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#27272A" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fontWeight: '800', fill: '#A1A1AA' }} />
                  <YAxis hide />
                  <Tooltip 
                    cursor={{ fill: 'transparent' }} 
                    contentStyle={{ backgroundColor: '#18181B', borderRadius: '12px', border: '1px solid #27272A', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.5)' }} 
                  />
                  <Bar dataKey="value" fill="#D4AF37" radius={[4, 4, 0, 0]} barSize={48} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="absolute top-0 right-0 w-32 h-32 bg-brand-gold/5 rounded-full -mr-16 -mt-16"></div>
        </div>

        <div className="space-y-12 py-14 border-y border-brand-border">
           <div className="bg-brand-card p-10 rounded-[12px] border border-brand-gold/20 space-y-4 shadow-sm">
              <p className="text-xl md:text-2xl text-brand-gold font-bold leading-relaxed text-center italic">
                "Você não está travado por falta de capacidade. Existe um padrão se repetindo — e ele ainda não foi totalmente revelado aqui."
              </p>
           </div>
           
           <div className="text-center space-y-6">
              <p className="text-brand-gold-soft font-black uppercase tracking-[0.2em] text-[10px]">Ação necessária imediata</p>
              <p className="text-2xl text-brand-muted font-medium italic leading-relaxed text-balance">
                Se isso continuar assim, a tendência é você repetir esse ciclo nos próximos dias.
              </p>
           </div>
        </div>

        <div className="space-y-12">
          <div className="text-center space-y-4">
             <p className="text-brand-muted font-medium">Você já viu uma parte do problema.</p>
             <p className="text-2xl text-brand-gold font-black uppercase tracking-tighter italic">Mas o ponto mais importante ainda está oculto.</p>
          </div>

          <div className="space-y-12">
            <button 
              id="btn-go-to-payment"
              onClick={onGoToPayment}
              className="w-full py-7 bg-brand-gold text-brand-bg font-bold text-2xl rounded-[8px] hover:bg-brand-gold-soft active:scale-95 transition-all shadow-2xl shadow-brand-gold/10 uppercase tracking-tight"
            >
              Quero meu plano completo por R$ 9,90
            </button>
            
            <div className="space-y-10 pt-4">
               <div className="flex items-center justify-center gap-6">
                  <div className="h-px bg-brand-border flex-1"></div>
                  <p className="text-brand-muted font-black uppercase tracking-[0.2em] text-[10px] whitespace-nowrap">O que você vai desbloquear:</p>
                  <div className="h-px bg-brand-border flex-1"></div>
               </div>
               <ul className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-2xl mx-auto px-4">
                  <li className="flex items-start gap-4 text-base font-bold text-brand-text">
                     <div className="p-1.5 bg-brand-gold/10 rounded-full text-brand-gold shrink-0 mt-0.5 shadow-xs">
                        <CheckCircle2 size={18} />
                     </div>
                     <span>O padrão exato que está te travando</span>
                  </li>
                  <li className="flex items-start gap-4 text-base font-bold text-brand-text">
                     <div className="p-1.5 bg-brand-gold/10 rounded-full text-brand-gold shrink-0 mt-0.5 shadow-xs">
                        <CheckCircle2 size={18} />
                     </div>
                     <span>O erro que você repete sem perceber</span>
                  </li>
                  <li className="flex items-start gap-4 text-base font-bold text-brand-text">
                     <div className="p-1.5 bg-brand-gold/10 rounded-full text-brand-gold shrink-0 mt-0.5 shadow-xs">
                        <CheckCircle2 size={18} />
                     </div>
                     <span>O que fazer nos próximos dias com clareza</span>
                  </li>
                  <li className="flex items-start gap-4 text-base font-bold text-brand-text">
                     <div className="p-1.5 bg-brand-gold/10 rounded-full text-brand-gold shrink-0 mt-0.5 shadow-xs">
                        <CheckCircle2 size={18} />
                     </div>
                     <span>Direcionamento real por IA profunda</span>
                  </li>
               </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const RegistrationView = ({ state, nameRef, emailRef, onRegister }: { state: QuizState; nameRef: React.RefObject<HTMLInputElement>; emailRef: React.RefObject<HTMLInputElement>; onRegister: () => void }) => (
  <div className="min-h-screen flex items-center justify-center px-6 py-12">
    <motion.div 
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      className="max-w-md w-full bg-brand-card rounded-[12px] p-12 shadow-2xl border border-brand-border space-y-10"
    >
      <div className="text-center space-y-4">
        <h2 className="text-3xl font-extrabold text-brand-gold leading-tight">Ver meu Resultado</h2>
        <p className="text-brand-muted font-medium text-balance">Identificamos padrões importantes. Preencha seus dados para ver seu diagnóstico inicial e desbloquear seu plano completo.</p>
        <div className="h-0.5 w-20 bg-brand-gold mx-auto rounded-full opacity-40"></div>
      </div>

      <div className="space-y-8">
        <div className="space-y-3">
          <label className="text-[10px] font-black text-brand-muted uppercase tracking-[0.2em] ml-1">Nome Completo</label>
          <input 
            type="text"
            ref={nameRef}
            defaultValue={state.userData.name}
            placeholder="Ex: João da Silva"
            className={`w-full p-5 bg-brand-bg border-2 rounded-[8px] outline-none transition-all font-semibold ${state.registrationError ? 'border-red-500' : 'border-transparent focus:border-brand-gold focus:bg-brand-bg'}`}
          />
        </div>

        <div className="space-y-3">
          <label className="text-[10px] font-black text-brand-muted uppercase tracking-[0.2em] ml-1">E-mail</label>
          <input 
            type="email"
            ref={emailRef}
            defaultValue={state.userData.email}
            placeholder="Ex: joao@email.com"
            className={`w-full p-5 bg-brand-bg border-2 rounded-[8px] outline-none transition-all font-semibold ${state.registrationError ? 'border-red-500' : 'border-transparent focus:border-brand-gold focus:bg-brand-bg'}`}
          />
        </div>

        {state.registrationError && (
          <motion.div 
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-5 bg-red-500/10 text-red-400 rounded-2xl flex items-center gap-3 border border-red-500/20"
          >
            <AlertCircle size={20} className="shrink-0" />
            <p className="text-sm font-bold">{state.registrationError}</p>
          </motion.div>
        )}

        <button 
          id="btn-submit-registration"
          onClick={onRegister}
          disabled={state.loadingReport}
          className="w-full py-6 bg-brand-gold text-brand-bg font-bold text-xl rounded-[8px] hover:bg-brand-gold-soft active:scale-95 transition-all flex items-center justify-center gap-4 disabled:opacity-50 shadow-xl shadow-brand-gold/10 uppercase tracking-tight"
        >
          {state.loadingReport ? (
            <>
              <Loader2 className="animate-spin" />
              Processando...
            </>
          ) : (
            'Salvar e Continuar'
          )}
        </button>
      </div>
    </motion.div>
  </div>
);

const PaymentView = ({ onPayment }: { onPayment: () => void }) => (
  <div className="min-h-screen flex items-center justify-center px-6 py-12">
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-lg w-full text-center space-y-10"
    >
      <div className="inline-flex p-6 bg-brand-card rounded-[12px] text-brand-gold shadow-lg border border-brand-border mb-2">
        <Zap size={56} className="fill-brand-gold" />
      </div>
      <div className="space-y-4">
        <h2 className="text-4xl font-extrabold text-brand-gold leading-tight text-balance uppercase tracking-tight italic">Último passo para seu desbloqueio</h2>
        <p className="text-xl text-brand-muted font-medium leading-relaxed max-w-sm mx-auto">Libere seu plano completo de ação com diagnóstico profundo de IA e direcionamento prático.</p>
      </div>

      <div className="space-y-6">
        <button 
          id="btn-payment"
          onClick={onPayment}
          className="w-full py-7 bg-brand-gold text-brand-bg font-bold text-2xl rounded-[8px] hover:bg-brand-gold-soft active:scale-95 transition-all shadow-2xl shadow-brand-gold/10 uppercase tracking-tight"
        >
          Desbloquear meu plano agora
        </button>
        <div className="flex items-center justify-center gap-3 text-brand-muted text-[10px] font-black uppercase tracking-[0.2em] pt-2">
           <Target size={14} className="text-brand-gold" /> Pagamento 100% Seguro
        </div>
      </div>
    </motion.div>
  </div>
);

const FullReportView = ({ state, dominantArea }: { state: QuizState; dominantArea: Area }) => {
  if (!state.report) return null;

  const firstName = state.userData.name.split(' ')[0];

  return (
    <div className="min-h-screen py-12 px-6 bg-brand-bg">
      <div className="max-w-4xl mx-auto space-y-16">
         <div className="text-center space-y-6">
          <h1 className="text-4xl md:text-5xl font-extrabold text-brand-gold uppercase italic text-balance leading-tight tracking-tight">
            {firstName}, este é o seu plano completo de desbloqueio
          </h1>
          <div className="h-0.5 w-40 bg-brand-gold/30 mx-auto rounded-full"></div>
          <p className="text-brand-muted font-medium max-w-2xl mx-auto mt-6 text-xl leading-relaxed">
            Com base no que você respondeu e, principalmente, no que você escreveu, identificamos um padrão de <span className="text-brand-gold font-black uppercase text-lg">{dominantArea}</span> que merece sua atenção imediata.
          </p>
        </div>

        <div className="bg-brand-card rounded-[12px] p-8 md:p-16 shadow-2xl shadow-black/50 border border-brand-border space-y-16 relative overflow-hidden">
          <div className="flex flex-col md:flex-row justify-between items-start gap-12 border-b border-brand-border pb-16">
             <div className="space-y-4">
               <p className="text-brand-gold text-[10px] font-black uppercase tracking-[0.4em]">Área Dominante</p>
               <h2 className="text-5xl md:text-6xl font-black text-brand-gold-soft tracking-tighter">{dominantArea}</h2>
             </div>
             <div className="bg-brand-bg p-8 rounded-[12px] border border-brand-border max-w-sm w-full shadow-inner relative">
               <p className="text-brand-muted text-[10px] font-black uppercase tracking-[0.2em] mb-4 italic opacity-70">Sua fala analisada:</p>
               <p className="text-base text-brand-text font-semibold leading-relaxed italic opacity-90">"{state.openAnswer}"</p>
               <div className="absolute top-4 right-6 text-brand-gold/20"><Zap size={24} /></div>
             </div>
          </div>

          <div className="space-y-16">
            <section className="space-y-6">
              <div className="flex items-center gap-4">
                <div className="w-2 h-8 bg-brand-gold rounded-full"></div>
                <h3 className="text-2xl font-extrabold text-brand-gold uppercase italic tracking-tight">Leitura Direta</h3>
              </div>
              <div className="text-xl text-brand-text leading-relaxed font-semibold bg-brand-bg p-10 md:p-14 rounded-[12px] border border-brand-border shadow-sm relative overflow-hidden">
                <p className="relative z-10">
                  {state.report.leituraDireta}
                </p>
                <div className="absolute top-0 right-0 w-64 h-64 bg-brand-gold/5 rounded-full -mr-32 -mt-32"></div>
              </div>
            </section>

            <div className="grid md:grid-cols-2 gap-16">
              <div className="space-y-14">
                <section className="space-y-6">
                  <h3 className="text-xs font-black text-brand-muted uppercase tracking-[0.3em] border-b border-brand-border pb-4">O que está acontecendo</h3>
                  <p className="text-lg text-brand-text leading-relaxed font-semibold opacity-90">
                    {state.report.oQueEstaAcontecendo}
                  </p>
                </section>

                <section className="space-y-6 p-8 bg-brand-gold/5 rounded-[12px] border border-brand-gold/20">
                  <h3 className="text-xs font-black text-brand-gold uppercase tracking-[0.3em] border-b border-brand-gold/10 pb-4">Erro Principal</h3>
                  <p className="text-2xl font-extrabold text-brand-text leading-tight italic">
                    {state.report.erroPrincipal}
                  </p>
                </section>

                <section className="space-y-6">
                  <h3 className="text-xs font-black text-brand-muted uppercase tracking-[0.3em] border-b border-brand-border pb-4">Consequência</h3>
                  <p className="text-lg text-brand-text italic font-semibold leading-relaxed">
                    {state.report.consequencia}
                  </p>
                </section>
              </div>

              <div className="space-y-14">
                 <section className="space-y-8">
                  <div className="flex items-center gap-4">
                    <div className="p-2.5 bg-brand-gold/10 rounded-xl text-brand-gold">
                      <Target size={32} />
                    </div>
                    <h3 className="text-2xl font-extrabold text-brand-gold uppercase italic tracking-tight">Plano de Desbloqueio</h3>
                  </div>
                  <div className="space-y-6">
                    {state.report.planoDesbloqueio.map((step, i) => (
                      <div key={i} className="group flex gap-8 p-8 bg-brand-bg rounded-[12px] items-center border border-brand-border text-brand-text shadow-lg hover:border-brand-gold/30 transition-all duration-300">
                        <span className="text-5xl font-black text-brand-gold/20 group-hover:text-brand-gold-soft/30 transition-colors leading-none font-serif">{i + 1}</span>
                        <p className="font-bold text-lg leading-snug">{step}</p>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="bg-brand-gold p-10 md:p-14 rounded-[12px] space-y-8 text-brand-bg shadow-2xl shadow-brand-gold/5 relative overflow-hidden">
                  <h3 className="text-[10px] font-black text-brand-bg/60 uppercase tracking-[0.4em] flex items-center gap-3">
                     <Compass size={18} /> Ajuste de Direção
                  </h3>
                  <div className="space-y-6 relative z-10">
                    <p className="text-lg font-medium leading-relaxed italic text-brand-bg/80">
                      Nos próximos dias, em vez de repetir a pergunta que te prende, experimente assumir uma postura que te mova.
                    </p>
                    <div className="h-px bg-brand-bg/10 w-full"></div>
                    <p className="text-2xl font-extrabold italic leading-tight text-brand-bg">
                      {state.report.ajusteDirecao}
                    </p>
                  </div>
                  <div className="absolute bottom-0 right-0 w-64 h-64 bg-white/5 rounded-full -mr-32 -mb-32"></div>
                </section>
              </div>
            </div>
          </div>

          <div className="pt-16 border-t border-brand-border text-center">
             <p className="text-3xl md:text-5xl font-extrabold italic text-brand-gold leading-tight text-balance opacity-90">
               "{state.report.fraseFinal}"
             </p>
          </div>
        </div>

        <div className="text-center space-y-8">
          <button 
            onClick={() => window.print()}
            className="px-10 py-4 bg-brand-card border border-brand-border text-brand-muted font-black uppercase tracking-[0.2em] text-[10px] rounded-full hover:bg-brand-bg hover:text-brand-gold transition-all shadow-sm"
          >
            Imprimir Relatório Completo
          </button>
          <div className="max-w-lg mx-auto space-y-4">
            <p className="text-brand-muted text-[10px] font-black uppercase tracking-widest opacity-40">
               Documento Confidencial • {firstName} • {new Date().toLocaleDateString('pt-BR')}
            </p>
            <p className="text-brand-muted text-[10px] font-medium leading-relaxed opacity-30">
               Este relatório é baseado em algoritmos de identificação comportamental e IA profunda. 
               As informações aqui contidas são para fins de orientação e não substituem acompanhamento profissional especializado.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default function App() {
  const openAnswerRef = useRef<HTMLTextAreaElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<QuizState>({
    step: 'home',
    currentQuestionIndex: 0,
    answers: {},
    areaScores: { 'Financeiro': 0, 'Relacionamento': 0, 'Emocional': 0, 'Clareza de Vida': 0 },
    identifiedArea: null,
    tieBreakerArea: null,
    openAnswer: '',
    analysis: null,
    report: null,
    loadingReport: false,
    userData: { name: '', email: '' },
    resultId: null,
    openAnswerError: null,
    registrationError: null,
    openAnswerCharCount: 0
  });

  const totalQuestions = 4 + 6 + 1; // 4 primary + 6 secondary + 1 open
  const progress = ((state.currentQuestionIndex) / totalQuestions) * 100;

  const currentQuestions = useMemo(() => {
    if (state.identifiedArea) {
      return [...PRIMARY_QUESTIONS, ...SECONDARY_QUESTIONS_MAP[state.identifiedArea]];
    }
    return PRIMARY_QUESTIONS;
  }, [state.identifiedArea]);

  const handleStart = () => {
    setState(prev => ({ ...prev, step: 'quiz', currentQuestionIndex: 0 }));
  };

  const handleAnswer = (score: number, area?: Area) => {
    const updatedScores = { ...state.areaScores };
    let newTieBreaker = state.tieBreakerArea;

    if (area) {
      updatedScores[area] += score;
    } else if (state.identifiedArea) {
      updatedScores[state.identifiedArea] += score;
    }

    const nextIndex = state.currentQuestionIndex + 1;

    // Track P4 answer as tie breaker
    if (state.currentQuestionIndex === 3 && area) {
      newTieBreaker = area;
    }

    // After 4 questions, identify the dominant area
    if (nextIndex === 4) {
      const sortedEntries = Object.entries(updatedScores) as [Area, number][];
      
      // Find the max score
      const maxScore = Math.max(...sortedEntries.map(e => e[1]));
      const topAreas = sortedEntries.filter(e => e[1] === maxScore);

      let dominant: Area;
      if (topAreas.length > 1 && newTieBreaker && topAreas.some(a => a[0] === newTieBreaker)) {
        // Tie breaker rule: use answer from P4
        dominant = newTieBreaker;
      } else {
        dominant = topAreas[0][0];
      }

      setState(prev => ({
        ...prev,
        areaScores: updatedScores,
        identifiedArea: dominant,
        tieBreakerArea: newTieBreaker,
        currentQuestionIndex: nextIndex
      }));
    } else {
      setState(prev => ({
        ...prev,
        areaScores: updatedScores,
        tieBreakerArea: newTieBreaker,
        currentQuestionIndex: nextIndex
      }));
    }
  };

  const handleFinalSubmit = () => {
    const textValue = openAnswerRef.current?.value || "";
    const text = textValue.trim();
    const textLength = text.length;

    if (textLength < 50) {
      setState(prev => ({ 
        ...prev, 
        openAnswer: textValue,
        openAnswerError: "Para gerar um diagnóstico preciso, escreva um pouco mais sobre o que você está vivendo." 
      }));
      return;
    }

    const currentDominant = state.identifiedArea as Area;
    
    // Update state with valid text for downstream views and persistence
    setState(prev => ({ ...prev, openAnswer: textValue }));

    const counts: Record<Area, number> = {
      'Emocional': EMOTIONAL_KEYWORDS.filter(k => text.includes(k)).length,
      'Financeiro': FINANCEIRO_KEYWORDS.filter(k => text.includes(k)).length,
      'Relacionamento': RELACIONAMENTO_KEYWORDS.filter(k => text.includes(k)).length,
      'Clareza de Vida': CLAREZA_KEYWORDS.filter(k => text.includes(k)).length,
    };

    const maxCount = Math.max(...Object.values(counts));
    let finalArea = currentDominant;
    if (maxCount > 0) {
      const entries = Object.entries(counts) as [Area, number][];
      const topCategory = entries.find(e => e[1] === maxCount);
      if (topCategory) finalArea = topCategory[0];
    }

    let intensity = 'média';
    if (INTENSITY_ALTA.some(k => text.includes(k))) intensity = 'alta';
    else if (INTENSITY_BAIXA.some(k => text.includes(k))) intensity = 'baixa';
    else if (INTENSITY_MEDIA.some(k => text.includes(k))) intensity = 'média';

    let time = 'não informado';
    if (TIME_LONGO.some(k => text.includes(k))) time = 'longo';
    else if (TIME_MEDIO.some(k => text.includes(k))) time = 'médio';
    else if (TIME_CURTO.some(k => text.includes(k))) time = 'curto';

    setState(prev => ({ 
      ...prev, 
      step: 'registration', 
      identifiedArea: finalArea,
      analysis: { intensity, time } 
    }));
  };

  const handleRegister = async () => {
    const nameValue = nameRef.current?.value || "";
    const emailValue = emailRef.current?.value || "";

    // Validation
    const isNameValid = nameValue.length >= 3 && nameValue.includes(' ');
    const isEmailValid = emailValue.includes('@') && emailValue.includes('.');

    if (!isNameValid || !isEmailValid) {
      setState(prev => ({ ...prev, registrationError: "Preencha corretamente seus dados para continuar." }));
      return;
    }

    setState(prev => ({ 
      ...prev, 
      loadingReport: true, 
      userData: { name: nameValue, email: emailValue },
      registrationError: null 
    }));
    
    // Collect user answer references for AI
    const primaryChoice = PRIMARY_QUESTIONS.find(q => state.answers[q.id] !== undefined)?.options[0].text || "";
    
    // Get high-score secondary answers (score 10)
    const secondaryReferences: string[] = [];
    Object.values(SECONDARY_QUESTIONS_MAP).flat().forEach(q => {
      if (state.answers[q.id] === 10) {
        secondaryReferences.push(q.text);
      }
    });

    const userContextText = `
      - Escolha principal: ${primaryChoice}
      - Confirmou situações reflexivas: ${secondaryReferences.join(', ')}
      - Escrita livre: ${state.openAnswer}
    `;

    // First generate AI report (required for database save)
    let aiReport = state.report;
    const currentName = nameValue;
    const currentEmail = emailValue;
    if (!aiReport) {
      try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const prompt = `EXECUTE COM PRECISÃO ABSOLUTA.
Gerar um relatório premium altamente claro, direto, emocional e aplicável imediatamente.

REGRAS OBRIGATÓRIAS DE CONTEÚDO (USE EXATAMENTE ESTES INÍCIOS):
1. No campo "leituraDireta", comece OBRIGATORIAMENTE com: "Você indicou que sente que..."
2. No campo "oQueEstaAcontecendo", comece OBRIGATORIAMENTE com: "Isso aparece quando você relata que..."
3. No campo "erroPrincipal", comece OBRIGATORIAMENTE com: "Esse padrão fica claro quando você demonstra..."
4. No campo "planoDesbloqueio[0]" (primeiro passo), comece OBRIGATORIAMENTE com: "Como você mencionou que..., o primeiro passo é..."

REGRAS GERAIS:
- Use pelo menos 2 referências reais contidas no contexto do usuário abaixo.
- Use trechos curtos.
- Linguagem natural e profunda (não robótica).
- Não parecer genérico.
- O nome do usuário é ${currentName}.
- Área Dominante: ${state.identifiedArea}.

ESTRUTURA DO JSON:
{
  "leituraDireta": "Você indicou que sente que... (análise curta)",
  "oQueEstaAcontecendo": "Isso aparece quando você relata que... (análise curta)",
  "erroPrincipal": "Esse padrão fica claro quando você demonstra... (diagnóstico forte)",
  "consequencia": "O que acontece se continuar assim (máximo 3 linhas).",
  "planoDesbloqueio": [
    "Como você mencionou que..., o primeiro passo é...",
    "prático nos próximos dias",
    "continuidade"
  ],
  "ajusteDirecao": "1 pergunta forte e específica.",
  "fraseFinal": "1 frase curta e impactante."
}

CONTEXTO DO USUÁRIO:
${userContextText}`;

        const response = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                leituraDireta: { type: Type.STRING },
                oQueEstaAcontecendo: { type: Type.STRING },
                erroPrincipal: { type: Type.STRING },
                consequencia: { type: Type.STRING },
                planoDesbloqueio: { type: Type.ARRAY, items: { type: Type.STRING } },
                ajusteDirecao: { type: Type.STRING },
                fraseFinal: { type: Type.STRING }
              },
              required: ["leituraDireta", "oQueEstaAcontecendo", "erroPrincipal", "consequencia", "planoDesbloqueio", "ajusteDirecao", "fraseFinal"]
            }
          }
        });
        aiReport = JSON.parse(response.text || '{}');
      } catch (e) {
        console.error("AI failed", e);
      }
    }

    // Save to Firestore
    const resultId = `res_${Date.now()}`;
    try {
      await setDoc(doc(db, 'results', resultId), {
        userName: currentName,
        userEmail: currentEmail,
        areaDominante: state.identifiedArea,
        respostas: state.areaScores,
        textoAberto: state.openAnswer,
        analiseSimplificada: state.analysis,
        relatorioIA: aiReport,
        createdAt: serverTimestamp(),
        hasPaid: false
      });

      setState(prev => ({ 
        ...prev, 
        step: 'result_simple', 
        resultId, 
        userData: { name: currentName, email: currentEmail },
        report: aiReport || prev.report,
        loadingReport: false 
      }));
    } catch (error) {
      console.error("Firebase save failed", error);
      setState(prev => ({ ...prev, loadingReport: false }));
    }
  };

  const handlePayment = () => {
    // Open external link
    window.open('https://www.mercadopago.com/br/', '_blank');
    
    // Simulate return logic for the demo (liberating access)
    setState(prev => ({ ...prev, step: 'result_full' }));
  };

  const dominantArea = state.identifiedArea as Area;
  const content = dominantArea ? RESULTS_CONTENT[dominantArea] : null;
  const chartData = [
    { name: 'FIN', value: state.areaScores['Financeiro'] },
    { name: 'REL', value: state.areaScores['Relacionamento'] },
    { name: 'EMO', value: state.areaScores['Emocional'] },
    { name: 'CLA', value: state.areaScores['Clareza de Vida'] },
  ];

  return (
    <div className="font-sans text-brand-text overflow-x-hidden antialiased selection:bg-brand-gold/20">
      <div className="fixed top-0 left-0 w-full h-[3px] bg-linear-to-r from-brand-gold to-brand-gold-soft z-50"></div>
      {state.step === 'home' && <HomeView onStart={handleStart} />}
      {state.step === 'quiz' && (
        <QuizView 
          state={state}
          currentQuestions={currentQuestions}
          progress={progress}
          openAnswerRef={openAnswerRef}
          onAnswer={handleAnswer}
          onFinalSubmit={handleFinalSubmit}
          onCharCountUpdate={(count) => setState(prev => ({ ...prev, openAnswerCharCount: count, openAnswerError: null }))}
        />
      )}
      {state.step === 'result_simple' && (
        <ResultSimpleView 
          state={state} 
          content={content} 
          chartData={chartData} 
          onGoToPayment={() => setState(prev => ({ ...prev, step: 'payment' }))} 
        />
      )}
      {state.step === 'registration' && (
        <RegistrationView 
          state={state}
          nameRef={nameRef}
          emailRef={emailRef}
          onRegister={handleRegister}
        />
      )}
      {state.step === 'payment' && <PaymentView onPayment={handlePayment} />}
      {state.step === 'result_full' && <FullReportView state={state} dominantArea={dominantArea} />}
    </div>
  );
}
