interface BenchmarkRow {
  name: string;
  description: string;
  category: 'Science' | 'Agentic' | 'Coding' | 'Reasoning' | 'Knowledge' | 'Overall';
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
    name: 'Artificial Analysis Index v4.1',
    description: 'Aggregate cross-domain capability score',
    scores: { taskforce: '51', gemini: '46', gpt: '55', claude: '60', grok: '38' },
  },
  // Agentic
  {
    category: 'Agentic',
    name: 'GDPval-AA v2',
    description: 'Agentic real-world work tasks',
    scores: { taskforce: '51%', gemini: '23%', gpt: '49%', claude: '63%', grok: '29%' },
  },
  {
    category: 'Agentic',
    name: 'Tau3-Banking',
    description: 'Agentic tool use (banking)',
    scores: { taskforce: '27%', gemini: '16%', gpt: '31%', claude: '27%', grok: '12%' },
  },
  {
    category: 'Coding',
    name: 'Terminal-Bench v2.1',
    description: 'Agentic coding and terminal use',
    scores: { taskforce: '78%', gemini: '74%', gpt: '84%', claude: '85%', grok: '40%' },
  },
  {
    category: 'Coding',
    name: 'SciCode',
    description: 'Scientific programming and simulation',
    scores: { taskforce: '50%', gemini: '59%', gpt: '56%', claude: '60%', grok: '47%' },
  },
  // Reasoning
  {
    category: 'Reasoning',
    name: 'HLE',
    description: "Humanity's Last Exam (Multimodal)",
    scores: { taskforce: '40%', gemini: '45%', gpt: '44%', claude: '53%', grok: '35%' },
  },
  {
    category: 'Science',
    name: 'GPQA Diamond',
    description: 'Graduate-level scientific reasoning',
    scores: { taskforce: '89%', gemini: '94%', gpt: '94%', claude: '93%', grok: '90%' },
  },
  {
    category: 'Science',
    name: 'CritPt',
    description: 'Physics research capabilities',
    scores: { taskforce: '21%', gemini: '18%', gpt: '27%', claude: '29%', grok: '8%' },
  },
  // Knowledge
  {
    category: 'Knowledge',
    name: 'AA-Omniscience Accuracy',
    description: 'Knowledge reliability',
    scores: { taskforce: '25%', gemini: '55%', gpt: '57%', claude: '61%', grok: '35%' },
  },
  {
    category: 'Knowledge',
    name: 'AA-Omniscience Non-Hallucination',
    description: 'Factual caution and abstention',
    scores: { taskforce: '72%', gemini: '50%', gpt: '14%', claude: '45%', grok: '75%' },
  },
  {
    category: 'Reasoning',
    name: 'AA-LCR',
    description: 'Long context reasoning',
    scores: { taskforce: '71%', gemini: '73%', gpt: '74%', claude: '70%', grok: '64%' },
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
                GPT-5.5 (xhigh)
              </th>

              {/* Claude */}
              <th className="w-[15.2%] border-b border-gray-200 p-1.5 text-center align-bottom font-medium text-gray-500 md:w-[14.4%] md:p-4">
                Claude Fable 5 (with fallback)
              </th>

              {/* Grok */}
              <th className="w-[15.2%] border-b border-gray-200 p-1.5 text-center align-bottom font-medium text-gray-500 md:w-[14.4%] md:p-4">
                Grok 4.3 (high)
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
          * Sentinel benchmark values do not represent end-to-end multi-agent system performance.
          Source:
          <a
            href="https://artificialanalysis.ai/leaderboards/models"
            className="font-semibold underline-offset-2 hover:underline"
          >
            artificialanalysis.ai
          </a>
          , accessed July 1, 2026.
        </p>
      </div>
    </div>
  );
}
