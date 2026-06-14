interface BenchmarkRow {
  name: string;
  description: string;
  category: 'Math' | 'Science' | 'Agentic' | 'Reasoning' | 'Knowledge' | 'Overall';
  scores: {
    taskforce: string | number | null;
    gemini: string | number | null;
    gpt: string | number | null;
    claude: string | number | null;
    grok: string | number | null;
  };
}

const benchmarks: BenchmarkRow[] = [
  // Overall
  {
    category: 'Overall',
    name: 'Artificial Analysis Index v4.0',
    description: 'Aggregate cross-domain capability score',
    scores: { taskforce: '53.9', gemini: '57.2', gpt: '60.2', claude: '61.4', grok: '53.2' },
  },
  // Science
  {
    category: 'Science',
    name: 'GPQA Diamond',
    description: 'Graduate-level scientific reasoning',
    scores: { taskforce: '91%', gemini: '94%', gpt: '94%', claude: '92%', grok: '90%' },
  },
  // Agentic
  {
    category: 'Agentic',
    name: 'GDPval-AA',
    description: 'Agentic real-world work tasks',
    scores: { taskforce: '49%', gemini: '41%', gpt: '63%', claude: '69%', grok: '50%' },
  },
  {
    category: 'Agentic',
    name: 'SciCode',
    description: 'Scientific programming & simulation',
    scores: { taskforce: '53%', gemini: '59%', gpt: '56%', claude: '53%', grok: '47%' },
  },
  {
    category: 'Agentic',
    name: 'Tau-Bench Telecom',
    description: 'Agentic tool use (Telecom)',
    scores: { taskforce: '96%', gemini: '96%', gpt: '94%', claude: '94%', grok: '98%' },
  },
  {
    category: 'Agentic',
    name: 'Terminal-Bench Hard',
    description: 'Linux command line mastery',
    scores: { taskforce: '44%', gemini: '54%', gpt: '61%', claude: '58%', grok: '38%' },
  },
  // Reasoning
  {
    category: 'Reasoning',
    name: 'HLE',
    description: "Humanity's Last Exam (Multimodal)",
    scores: { taskforce: '36%', gemini: '45%', gpt: '44%', claude: '46%', grok: '35%' },
  },
  {
    category: 'Reasoning',
    name: 'AA-LCR',
    description: 'Long Context Reasoning',
    scores: { taskforce: '70%', gemini: '73%', gpt: '74%', claude: '68%', grok: '64%' },
  },
  {
    category: 'Reasoning',
    name: 'CritPt',
    description: 'Physics research capabilities',
    scores: { taskforce: '8%', gemini: '18%', gpt: '27%', claude: '21%', grok: '8%' },
  },
  // Knowledge
  {
    category: 'Knowledge',
    name: 'AA-Omniscience Accuracy',
    description: 'Knowledge reliability',
    scores: { taskforce: '33%', gemini: '55%', gpt: '57%', claude: '47%', grok: '35%' },
  },
  {
    category: 'Knowledge',
    name: 'IFBench',
    description: 'Instruction Following',
    scores: { taskforce: '76%', gemini: '77%', gpt: '76%', claude: '62%', grok: '81%' },
  },
];

export function BenchmarkTable() {
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl">
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse text-[10px] sm:text-xs md:text-sm">
          <thead>
            <tr>
              <th className="w-[24%] border-b border-gray-200 bg-gray-50/50 p-1.5 text-left align-bottom font-medium text-gray-500 md:w-[28%] md:p-4">
                Benchmark
              </th>

              {/* TaskForceAI */}
              <th className="w-[15.2%] border-b border-gray-200 bg-slate-50 p-1.5 text-center align-bottom font-bold text-slate-900 md:w-[14.4%] md:p-4">
                <div className="flex flex-col items-center">
                  <span>Sentinel</span>
                  <span className="mt-0.5 origin-center scale-90 text-[8px] font-normal whitespace-nowrap text-slate-500 md:mt-1 md:scale-100 md:text-[10px]">
                    TaskForceAI model
                  </span>
                </div>
              </th>

              {/* Gemini */}
              <th className="w-[15.2%] border-b border-gray-200 p-1.5 text-center align-bottom font-medium text-gray-500 md:w-[14.4%] md:p-4">
                Gemini 3.1 Pro Preview
              </th>

              {/* GPT */}
              <th className="w-[15.2%] border-b border-gray-200 p-1.5 text-center align-bottom font-medium text-gray-500 md:w-[14.4%] md:p-4">
                GPT-5.5
              </th>

              {/* Claude */}
              <th className="w-[15.2%] border-b border-gray-200 p-1.5 text-center align-bottom font-medium text-gray-500 md:w-[14.4%] md:p-4">
                Claude Fable 5
              </th>

              {/* Grok */}
              <th className="w-[15.2%] border-b border-gray-200 p-1.5 text-center align-bottom font-medium text-gray-500 md:w-[14.4%] md:p-4">
                Grok 4.3
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {benchmarks.map((row, idx) => (
              <tr key={idx} className="group hover:bg-gray-50/50">
                <td className="p-1.5 align-top md:p-4">
                  <span className="block leading-tight font-semibold text-gray-900">
                    {row.name}
                  </span>
                  <span className="mt-0.5 block text-[9px] leading-tight text-gray-500 md:text-xs">
                    {row.description}
                  </span>
                </td>

                {/* TaskForceAI Column (Highlighted) */}
                <td className="border-x border-slate-100 bg-slate-50/50 p-1.5 text-center align-middle font-bold text-slate-900 md:p-4">
                  {row.scores.taskforce ? (
                    <span className="text-emerald-700">{row.scores.taskforce}</span>
                  ) : (
                    <span className="text-gray-300 select-none">&mdash;</span>
                  )}
                </td>

                {/* Gemini */}
                <td className="p-1.5 text-center align-middle font-medium text-gray-600 tabular-nums md:p-4">
                  {row.scores.gemini}
                </td>

                {/* GPT */}
                <td className="p-1.5 text-center align-middle font-medium text-gray-600 tabular-nums md:p-4">
                  {row.scores.gpt}
                </td>

                {/* Claude */}
                <td className="p-1.5 text-center align-middle font-medium text-gray-600 tabular-nums md:p-4">
                  {row.scores.claude}
                </td>

                {/* Grok */}
                <td className="p-1.5 text-center align-middle font-medium text-gray-600 tabular-nums md:p-4">
                  {row.scores.grok}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t border-gray-200 bg-gray-50/50 px-4 py-3">
        <p className="text-center text-[9px] text-gray-600">
          * Sentinel results do not represent end-to-end multi-agent system performance. Source:
          artificialanalysis.ai, accessed June 3, 2026.
        </p>
      </div>
    </div>
  );
}
