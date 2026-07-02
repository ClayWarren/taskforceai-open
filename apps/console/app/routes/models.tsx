import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Zap, Info, Shield, Sparkles, Brain, Cpu, AlertCircle } from 'lucide-react';

import { Badge } from '../components/ui/badge';
import { fetchModels } from '../lib/api/models';

export const Route = createFileRoute('/models')({
  component: ModelsPage,
  errorComponent: ({ error }) => (
    <div className="flex min-h-[400px] flex-col items-center justify-center space-y-4">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10">
        <AlertCircle className="h-8 w-8 text-red-500" />
      </div>
      <div className="text-center">
        <h2 className="text-xl font-bold text-white">Failed to load models</h2>
        <p className="mt-2 max-w-md text-sm text-slate-400">{error.message}</p>
      </div>
    </div>
  ),
});

function getModelIcon(id: string) {
  if (id.includes('fast')) return <Zap className="h-6 w-6 text-blue-500" />;
  if (id.includes('pro') || id.includes('opus'))
    return <Sparkles className="h-6 w-6 text-purple-500" />;
  if (
    id.includes('reasoning') ||
    id.includes('heavy') ||
    id.includes('sentinel') ||
    id.includes('glm-5.2')
  )
    return <Brain className="h-6 w-6 text-emerald-500" />;
  if (id.includes('gpt-5')) return <Cpu className="h-6 w-6 text-orange-500" />;
  return <Shield className="h-6 w-6 text-slate-500" />;
}

function getIconBgColor(id: string) {
  if (id.includes('fast')) return 'border-blue-500/20 bg-blue-600/10 group-hover:bg-blue-600/20';
  if (id.includes('pro') || id.includes('opus'))
    return 'border-purple-500/20 bg-purple-600/10 group-hover:bg-purple-600/20';
  if (
    id.includes('reasoning') ||
    id.includes('heavy') ||
    id.includes('sentinel') ||
    id.includes('glm-5.2')
  )
    return 'border-emerald-500/20 bg-emerald-600/10 group-hover:bg-emerald-600/20';
  if (id.includes('gpt-5'))
    return 'border-orange-500/20 bg-orange-600/10 group-hover:bg-orange-600/20';
  return 'border-slate-500/20 bg-slate-600/10 group-hover:bg-slate-600/20';
}

function getCapabilityLevel(usageMultiple: number = 1): number {
  if (usageMultiple < 0.5) return 2; // Fast/Small
  if (usageMultiple <= 1) return 4; // Medium/Standard
  return 5; // High/Reasoning
}

function ModelsPage() {
  const { data: models } = useSuspenseQuery({
    queryKey: ['models'],
    queryFn: () => fetchModels(),
  });

  return (
    <div className="space-y-12 duration-500 animate-in fade-in">
      <div>
        <h1 className="text-4xl font-bold tracking-tight text-white">Models</h1>
        <p className="mt-2 text-slate-400">Available models and orchestration engines</p>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {models.options.map((model) => {
          const capabilityLevel = getCapabilityLevel(model.usageMultiple);

          return (
            <div
              key={model.id}
              className="group rounded-2xl border border-white/10 bg-white/[0.02] p-8 transition-colors hover:bg-white/[0.04]"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-4">
                  <div
                    className={`flex h-12 w-12 items-center justify-center rounded-xl border transition-colors ${getIconBgColor(model.id)}`}
                  >
                    {getModelIcon(model.id)}
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-white">{model.label}</h3>
                    <code className="text-xs text-slate-500">{model.id}</code>
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className="border-white/10 text-[10px] tracking-widest text-slate-400 uppercase"
                >
                  {model.badge}
                </Badge>
              </div>

              <p className="mt-6 max-w-2xl text-slate-400">{model.description}</p>

              <div className="mt-8 grid grid-cols-3 gap-12 border-t border-white/5 pt-8">
                <div>
                  <p className="text-[10px] font-bold tracking-widest text-slate-500 uppercase">
                    Cost Multiplier
                  </p>
                  <p className="mt-1 text-sm font-bold text-white">{model.usageMultiple ?? 1}x</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold tracking-widest text-slate-500 uppercase">
                    Default Model
                  </p>
                  <p className="mt-1 text-sm font-bold text-white">
                    {model.id === models.defaultModelId ? 'Yes' : 'No'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-bold tracking-widest text-slate-500 uppercase">
                    Reasoning Capability
                  </p>
                  <div className="mt-2 flex gap-1">
                    {[1, 2, 3, 4, 5].map((level) => (
                      <div
                        key={level}
                        className={`h-1 w-4 rounded-full ${level <= capabilityLevel ? 'bg-blue-600' : 'bg-white/10'}`}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-start gap-4 rounded-xl border border-blue-500/10 bg-blue-600/5 p-6 text-sm">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-blue-500" />
        <p className="text-blue-200/70 italic">
          Custom fine-tuned models and specialized agents are available upon request for Enterprise
          customers. Contact sales to learn more about TaskForce Custom.
        </p>
      </div>
    </div>
  );
}
