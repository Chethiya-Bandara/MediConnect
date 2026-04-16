import { BarChart3, FileText, RefreshCw } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { EmptyState } from "../../../components/feedback/EmptyState";
import { ErrorState } from "../../../components/feedback/ErrorState";
import { LoadingState } from "../../../components/feedback/LoadingState";
import { formatDate } from "../../../lib/utils/formatDate";
import type { AnalyticsFilters, DiagnosisMetric } from "../types";

interface AnalyticsSectionProps {
  filters: AnalyticsFilters;
  incidence: DiagnosisMetric[];
  topDiagnoses: DiagnosisMetric[];
  report: string | null;
  reportGeneratedAt: string | null;
  error: string | null;
  reportMessage: string | null;
  isLoading: boolean;
  isGeneratingReport: boolean;
  onFiltersChange: (nextFilters: AnalyticsFilters) => void;
  onRefresh: (filters: AnalyticsFilters) => Promise<boolean>;
  onGenerateReport: () => Promise<boolean>;
}

export function AnalyticsSection({
  filters,
  incidence,
  topDiagnoses,
  report,
  reportGeneratedAt,
  error,
  reportMessage,
  isLoading,
  isGeneratingReport,
  onFiltersChange,
  onRefresh,
  onGenerateReport,
}: AnalyticsSectionProps) {
  if (isLoading) {
    return <LoadingState message="Loading health ministry analytics..." />;
  }

  if (error) {
    return (
      <ErrorState
        title="Analytics unavailable"
        message={`${error} The backend may still be missing mounted MOH routes, so this section is being honest instead of cute.`}
      />
    );
  }

  return (
    <section className="space-y-5">
      <div className="rounded-[1.8rem] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              Disease Incidence Analytics
            </h2>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Query district and date-window trends using only aggregated diagnosis data.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 xl:min-w-[42rem]">
            <label className="space-y-2">
              <span className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">
                Start date
              </span>
              <input
                type="date"
                value={filters.startDate}
                onChange={(event) =>
                  onFiltersChange({ ...filters, startDate: event.target.value })
                }
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm focus:border-primary focus:ring-primary dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              />
            </label>

            <label className="space-y-2">
              <span className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">
                End date
              </span>
              <input
                type="date"
                value={filters.endDate}
                onChange={(event) =>
                  onFiltersChange({ ...filters, endDate: event.target.value })
                }
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm focus:border-primary focus:ring-primary dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              />
            </label>

            <label className="space-y-2">
              <span className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">
                District
              </span>
              <input
                value={filters.district}
                onChange={(event) =>
                  onFiltersChange({ ...filters, district: event.target.value })
                }
                placeholder="Optional district"
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm focus:border-primary focus:ring-primary dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              />
            </label>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <Button
            type="button"
            onClick={() => void onRefresh(filters)}
            className="inline-flex items-center gap-2 bg-primary px-5 py-3 text-white dark:bg-blue-600"
          >
            <RefreshCw size={16} />
            Refresh Analytics
          </Button>
          <Button
            type="button"
            isLoading={isGeneratingReport}
            onClick={() => void onGenerateReport()}
            className="inline-flex items-center gap-2 bg-slate-900 px-5 py-3 text-white dark:bg-slate-100 dark:text-slate-900"
          >
            <FileText size={16} />
            Generate Monthly Report
          </Button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.9fr,1.1fr]">
        <article className="rounded-[1.8rem] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-5 flex items-start gap-3">
            <BarChart3 className="mt-1 text-primary dark:text-blue-400" size={20} />
            <div>
              <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                Top Diagnoses
              </h3>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                Highest-frequency codes returned by the MOH ranking endpoint.
              </p>
            </div>
          </div>

          {topDiagnoses.length === 0 ? (
            <EmptyState
              title="No top diagnoses yet"
              description="The endpoint returned no diagnosis rankings for the current environment."
            />
          ) : (
            <div className="space-y-3">
              {topDiagnoses.map((item, index) => (
                <div
                  key={`${item.code}-${index}`}
                  className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3 dark:bg-slate-800/60"
                >
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">
                      Rank {index + 1}
                    </p>
                    <p className="mt-1 font-semibold text-slate-900 dark:text-slate-100">
                      {item.code}
                    </p>
                  </div>
                  <p className="text-lg font-extrabold text-slate-900 dark:text-slate-100">
                    {item.count}
                  </p>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="rounded-[1.8rem] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-5 flex items-start gap-3">
            <FileText className="mt-1 text-emerald-600 dark:text-emerald-400" size={20} />
            <div>
              <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                Incidence + Report
              </h3>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                Aggregated disease metrics and monthly AI-style summary output.
              </p>
            </div>
          </div>

          {incidence.length === 0 ? (
            <EmptyState
              title="No incidence data"
              description="Either no diagnoses matched the selected range, or the environment does not have analytics rows yet."
            />
          ) : (
            <div className="flex flex-wrap gap-3">
              {incidence.map((item) => (
                <div
                  key={item.code}
                  className="rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-700 dark:border-slate-700 dark:text-slate-200"
                >
                  <strong className="block text-slate-900 dark:text-slate-100">{item.code}</strong>
                  {item.count} reported cases
                </div>
              ))}
            </div>
          )}

          {reportMessage ? (
            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200">
              {reportMessage}
            </div>
          ) : null}

          <div className="mt-5 rounded-2xl bg-slate-50 px-5 py-4 dark:bg-slate-800/60">
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">
              Generated report
            </p>
            <p className="mt-3 text-sm leading-7 text-slate-700 dark:text-slate-200">
              {report ?? "No monthly report generated yet."}
            </p>
            {reportGeneratedAt ? (
              <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                Generated {formatDate(reportGeneratedAt)}
              </p>
            ) : null}
          </div>
        </article>
      </div>
    </section>
  );
}
