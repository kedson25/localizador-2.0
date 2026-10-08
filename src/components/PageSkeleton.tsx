import React from 'react';

type SkeletonVariant = 'default' | 'cards' | 'table' | 'numbers';

export function PageSkeleton({ variant = 'default', className = '' }: { variant?: SkeletonVariant | string; className?: string }) {
  const line = (width: string, height = 'h-4') => (
    <div aria-hidden="true" className={`animate-pulse rounded bg-slate-200 ${height} ${width}`} />
  );

  if (variant === 'numbers') {
    return (
      <div role="status" aria-label="Carregando indicadores" className={`grid grid-cols-2 gap-3 sm:grid-cols-4 ${className}`}>
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="min-w-0 rounded-lg border border-slate-200 bg-white p-4">
            {line('w-20', 'h-3')}
            <div className="mt-3">{line('w-16', 'h-7')}</div>
          </div>
        ))}
      </div>
    );
  }

  if (variant === 'table') {
    return (
      <div role="status" aria-label="Carregando tabela" className={`overflow-hidden rounded-lg border border-slate-200 bg-white ${className}`}>
        <div className="flex gap-6 border-b border-slate-200 p-4">{line('w-28')}{line('w-20')}{line('w-20')}</div>
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="flex gap-6 border-b border-slate-100 p-4">
            {line('w-28')}{line('w-20')}{line('w-20')}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div role="status" aria-label="Carregando conteúdo" className={`space-y-4 ${className}`}>
      {line('w-40', 'h-7')}
      <div className={variant === 'cards' ? 'grid grid-cols-2 gap-3 sm:grid-cols-4' : 'space-y-4'}>
        {Array.from({ length: variant === 'cards' ? 4 : 2 }, (_, index) => (
          <div key={index} className="rounded-lg border border-slate-200 bg-white p-4">
            {line('w-24', 'h-3')}
            <div className="mt-4">{line(index % 2 ? 'w-24' : 'w-2/3', variant === 'cards' ? 'h-8' : 'h-20')}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
