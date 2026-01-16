
import React, { useState, useRef } from 'react';

interface Props {
  onTap: () => void;
  disabled?: boolean;
}

const TouchArea: React.FC<Props> = ({ onTap, disabled }) => {
  const [isPressed, setIsPressed] = useState(false);
  const lastInputTime = useRef<number>(0);

  const handleInput = (e: React.TouchEvent | React.MouseEvent) => {
    if (disabled) return;
    const now = Date.now();
    if (now - lastInputTime.current < 80) return; // Debounce otimizado
    if (e.type === 'touchstart') {
      if (e.cancelable) e.preventDefault();
    }
    lastInputTime.current = now;
    setIsPressed(true);
    onTap();
  };

  const handleEnd = () => setIsPressed(false);

  return (
    <div
      onMouseDown={handleInput}
      onMouseUp={handleEnd}
      onMouseLeave={handleEnd}
      onTouchStart={handleInput}
      onTouchEnd={handleEnd}
      className={`
        relative w-full h-40 md:h-48 rounded-[2rem] flex items-center justify-center
        transition-all duration-75 select-none touch-none cursor-pointer
        ${isPressed ? 'bg-orange-600 scale-[0.98]' : 'bg-[#1a0f0a] border-2 border-orange-900/30'}
        shadow-2xl active:shadow-inner
      `}
    >
      <div className={`
        flex flex-col items-center gap-2 transition-all
        ${isPressed ? 'scale-90 opacity-100' : 'opacity-80'}
      `}>
        <div className={`
          w-16 h-16 rounded-full flex items-center justify-center border-4 transition-all
          ${isPressed ? 'bg-white border-white text-orange-600' : 'bg-orange-600 border-orange-400/20 text-white'}
        `}>
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={4} d="M5 15l7-7 7 7" />
          </svg>
        </div>
        <span className={`text-[10px] font-black uppercase tracking-[0.4em] ${isPressed ? 'text-white' : 'text-orange-900'}`}>
          BATIDA
        </span>
      </div>
    </div>
  );
};

export default TouchArea;
