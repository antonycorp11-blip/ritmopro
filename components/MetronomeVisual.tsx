
import React from 'react';

interface Props {
  activeBeat: number;
  totalBeats?: number;
}

const MetronomeVisual: React.FC<Props> = ({ activeBeat, totalBeats = 4 }) => {
  return (
    <div className="flex justify-center items-center gap-4 py-8">
      {Array.from({ length: totalBeats }).map((_, i) => (
        <div
          key={i}
          className={`w-4 h-4 rounded-full transition-all duration-100 ${
            activeBeat === i 
              ? 'bg-blue-600 scale-150 shadow-lg' 
              : 'bg-gray-300 scale-100'
          }`}
        />
      ))}
    </div>
  );
};

export default MetronomeVisual;
