import React from 'react';

// Mesma marca do Logo.astro, mas como componente React hidratado (client:load)
// para garantir que o clique seja tratado dentro da árvore do React, e não
// dependa de uma âncora estática do Astro perto de ilhas React.
export const LogoLink: React.FC = () => {
  return (
    <a href="/" aria-label="Ir para a página inicial" className="cursor-pointer select-none inline-block">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 50" className="w-48 h-12">
        <defs>
          <linearGradient id="p2pGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#ea580c" stopOpacity={0.4} />
            <stop offset="100%" stopColor="#ea580c" stopOpacity={1} />
          </linearGradient>
        </defs>

        <path
          d="M 15 32 Q 35 8, 62 26 T 115 30 Q 140 40, 165 24"
          fill="none"
          stroke="url(#p2pGradient)"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeDasharray="5 4"
        />

        <text x="10" y="35" fontFamily="system-ui, sans-serif" fontWeight={800} fontSize={26} fill="#f4f4f5" letterSpacing="-0.5">
          Envio
        </text>
        <text x="88" y="35" fontFamily="system-ui, sans-serif" fontWeight={900} fontSize={28} fill="#ea580c">
          2
        </text>
        <text x="106" y="35" fontFamily="system-ui, sans-serif" fontWeight={700} fontSize={26} fill="#f4f4f5">
          p
        </text>

        <g transform="translate(126, 14)">
          <rect x="0" y="0" width="24" height="18" rx="3" fill="none" stroke="#ea580c" strokeWidth={2} />
          <path d="M 2 3 L 12 10 L 22 3" fill="none" stroke="#ea580c" strokeWidth={2} strokeLinejoin="round" />
        </g>
      </svg>
    </a>
  );
};
