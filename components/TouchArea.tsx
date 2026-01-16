
import React, { useState, useRef } from 'react';

interface Props {
  onTap: () => void;
  disabled?: boolean;
}

const TouchArea: React.FC<Props> = ({ onTap, disabled }) => {
  const [isPressed, setIsPressed] = useState(false);
  // Ref para evitar que eventos de mouse e touch disparem a mesma função simultaneamente
  const lastInputTime = useRef<number>(0);

  const handleInput = (e: React.TouchEvent | React.MouseEvent) => {
    if (disabled) return;

    const now = Date.now();
    // Previne disparos múltiplos em janelas de tempo inferiores a 100ms
    if (now - lastInputTime.current < 100) return;
    
    // Se for touch, cancelamos o evento de mouse emulado que o navegador enviaria depois
    if (e.type === 'touchstart') {
      if (e.cancelable) e.preventDefault();
    }

    lastInputTime.current = now;
    setIsPressed(true);
    onTap();
  };

  const handleEnd = () => {
    setIsPressed(false);
  };

  return (
    <div
      onMouseDown={handleInput}
      onMouseUp={handleEnd}
      onMouseLeave={handleEnd}
      onTouchStart={handleInput}
      onTouchEnd={handleEnd}
      className={`
        relative w-full h-48 md:h-56 rounded-[3.5rem] flex items-center justify-center
        transition-all duration-75 select-none touch-none cursor-pointer
        ${isPressed ? 'bg-orange-600/40 scale-[0.97] shadow-inner' : 'bg-[#1a0f0a] border-2 border-[#2d1b14] hover:border-orange-500/30'}
        shadow-2xl overflow-hidden
      `}
    >
      {/* Background Pulse Circle */}
      <div className={`absolute w-40 h-40 rounded-full bg-orange-500/10 blur-3xl transition-all duration-300 ${isPressed ? 'scale-150 opacity-100' : 'scale-100 opacity-0'}`}></div>
      
      <div className={`
        w-28 h-28 rounded-full border-4 flex items-center justify-center transition-all
        ${isPressed ? 'border-white scale-110 shadow-[0_0_50px_rgba(249,115,22,0.6)]' : 'border-orange-900/40'}
      `}>
        <div className={`
          w-20 h-20 rounded-full flex items-center justify-center transition-all shadow-xl
          ${isPressed ? 'bg-white scale-90' : 'bg-orange-600'}
        `}>
          <svg className={`w-12 h-12 transition-colors ${isPressed ? 'text-orange-600' : 'text-white'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={4} d="M5 15l7-7 7 7" />
          </svg>
        </div>
      </div>
      
      <div className="absolute bottom-6 flex flex-col items-center">
        <p className={`text-[12px] font-black uppercase tracking-[0.6em] transition-all ${isPressed ? 'text-white translate-y-[-2px]' : 'text-orange-900'}`}>
          BATIDA
        </p>
        <div className={`h-[3px] transition-all mt-1.5 ${isPressed ? 'w-12 bg-white' : 'w-6 bg-orange-950'}`}></div>
      </div>
    </div>
  );
};

export default TouchArea;
