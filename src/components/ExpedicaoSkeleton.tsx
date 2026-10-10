import React from 'react';

function Block({ className = '' }: { className?: string; key?: React.Key }) {
  return <div className={`animate-pulse bg-slate-200 ${className}`} />;
}

export function ExpedicaoSkeleton() {
  return (
    <div className="w-full space-y-3" aria-busy="true" aria-label="Carregando Expedição">
      <section className="border border-slate-300 bg-white px-5 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Block className="h-10 w-10" />
            <div className="space-y-2">
              <Block className="h-2.5 w-20" />
              <Block className="h-6 w-48" />
            </div>
          </div>
          <div className="hidden gap-2 md:flex">
            {Array.from({ length: 5 }, (_, index) => <Block key={index} className="h-9 w-24" />)}
          </div>
        </div>
      </section>

      <Block className="h-10 w-full border border-slate-300" />

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="border border-slate-300 bg-white p-4">
            <Block className="h-2.5 w-24" />
            <Block className="mt-3 h-8 w-16" />
          </div>
        ))}
      </div>

      <section className="border border-slate-300 bg-white p-3">
        <div className="mb-3 flex items-center justify-between">
          <Block className="h-5 w-28" />
          <Block className="h-8 w-20" />
        </div>
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_440px]">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {Array.from({ length: 20 }, (_, index) => (
              <div key={index} className="min-h-[150px] border border-slate-200 bg-white p-3">
                <Block className="h-4 w-16" />
                <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-200 pt-3">
                  <div className="space-y-2"><Block className="h-2 w-12" /><Block className="h-6 w-8" /></div>
                  <div className="space-y-2"><Block className="h-2 w-14" /><Block className="h-6 w-8" /></div>
                </div>
                <Block className="mt-5 h-1 w-full" />
              </div>
            ))}
          </div>
          <div className="h-[620px] border border-slate-200 bg-white p-3">
            <Block className="h-6 w-32" />
            <div className="mt-4 space-y-3">
              {Array.from({ length: 6 }, (_, index) => (
                <div key={index} className="border-b border-slate-200 pb-3">
                  <Block className="h-4 w-32" />
                  <Block className="mt-2 h-3 w-full" />
                  <Block className="mt-2 h-3 w-4/5" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="border border-slate-300 bg-white">
        <div className="flex gap-2 border-b border-slate-200 p-3">
          <Block className="h-9 w-20" />
          <Block className="h-9 w-28" />
          <Block className="h-9 w-32" />
          <Block className="ml-auto h-9 w-64" />
        </div>
        <div className="space-y-px">
          {Array.from({ length: 7 }, (_, index) => <Block key={index} className="h-10 w-full" />)}
        </div>
      </section>
    </div>
  );
}
