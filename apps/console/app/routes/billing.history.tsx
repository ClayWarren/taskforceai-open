import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { FileText, Loader2, ExternalLink, AlertCircle } from 'lucide-react';
import { Button } from '../components/ui/button';
import { fetchInvoices } from '../lib/api/billing';
import { logger } from '../lib/logger';
import {
  redactBillingUrlForLogs,
  resolveTrustedBillingInvoiceUrl,
} from '../lib/utils/billing-portal';

export const Route = createFileRoute('/billing/history')({
  component: BillingHistoryPage,
});

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(timestamp * 1000));
}

function formatCurrency(amount: number, currency: string): string {
  const normalizedCurrency = currency.trim().toUpperCase();
  const fallbackFormatter = () =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);

  if (!/^[A-Z]{3}$/.test(normalizedCurrency)) {
    logger.warn('Invalid invoice currency code encountered', { currency: normalizedCurrency });
    return fallbackFormatter();
  }

  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: normalizedCurrency,
    }).format(amount);
  } catch (error) {
    logger.warn('Failed to format invoice currency', {
      currency: normalizedCurrency,
      error,
    });
    return fallbackFormatter();
  }
}

function getStatusBadge(status: string) {
  switch (status.toLowerCase()) {
    case 'paid':
      return (
        <span className="inline-flex items-center rounded-full bg-green-500/10 px-2 py-1 text-[10px] font-medium text-green-400">
          Paid
        </span>
      );
    case 'open':
      return (
        <span className="inline-flex items-center rounded-full bg-yellow-500/10 px-2 py-1 text-[10px] font-medium text-yellow-400">
          Pending
        </span>
      );
    case 'void':
    case 'uncollectible':
      return (
        <span className="inline-flex items-center rounded-full bg-red-500/10 px-2 py-1 text-[10px] font-medium text-red-400">
          Failed
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center rounded-full bg-slate-500/10 px-2 py-1 text-[10px] font-medium text-slate-400">
          {status}
        </span>
      );
  }
}

function BillingHistoryPage() {
  const {
    data: invoices,
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['billing', 'invoices'],
    queryFn: () => fetchInvoices(),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!invoices || !invoices.ok) {
    const errorMessage =
      invoices && !invoices.ok
        ? invoices.error.message
        : 'Billing history is currently unavailable.';

    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
          <div className="space-y-3">
            <div>
              <h2 className="text-lg font-bold text-white">Unable to load billing history</h2>
              <p className="text-sm text-red-200/90">{errorMessage}</p>
            </div>
            <Button
              onClick={() => {
                void refetch();
              }}
              disabled={isFetching}
              className="bg-white text-black hover:bg-slate-200"
            >
              {isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Retry
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const invoiceList = invoices.value;
  const hasInvoices = invoiceList.length > 0;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold text-white">Billing history</h2>
        <p className="text-sm text-slate-400">View and download your past invoices.</p>
      </div>

      <div className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]">
        {!hasInvoices ? (
          <div className="p-8 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-white/5">
              <FileText className="h-6 w-6 text-slate-500" />
            </div>
            <h3 className="text-lg font-bold text-white">No invoices yet</h3>
            <p className="mt-1 text-slate-400">
              Your invoice history will appear here once you make a purchase.
            </p>
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-white/10 bg-white/5 text-[10px] font-bold tracking-widest text-slate-500 uppercase">
              <tr>
                <th className="px-6 py-4">Date</th>
                <th className="px-6 py-4">Invoice</th>
                <th className="px-6 py-4">Amount</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {invoiceList.map((invoice) => {
                const invoicePdfLink = invoice.invoicePdf
                  ? resolveTrustedBillingInvoiceUrl(invoice.invoicePdf)
                  : null;
                const hostedInvoiceLink = invoice.hostedUrl
                  ? resolveTrustedBillingInvoiceUrl(invoice.hostedUrl)
                  : null;

                if (invoicePdfLink && !invoicePdfLink.ok) {
                  logger.warn('Rejected invoice PDF link URL', {
                    url: redactBillingUrlForLogs(invoice.invoicePdf ?? ''),
                    reason: invoicePdfLink.error.kind,
                  });
                }

                if (hostedInvoiceLink && !hostedInvoiceLink.ok) {
                  logger.warn('Rejected hosted invoice URL', {
                    url: redactBillingUrlForLogs(invoice.hostedUrl ?? ''),
                    reason: hostedInvoiceLink.error.kind,
                  });
                }

                const trustedInvoicePdfLink = invoicePdfLink?.ok ? invoicePdfLink.value : null;
                const trustedHostedInvoiceLink = hostedInvoiceLink?.ok
                  ? hostedInvoiceLink.value
                  : null;

                return (
                  <tr key={invoice.id} className="group hover:bg-white/[0.02]">
                    <td className="px-6 py-4 text-white">{formatDate(invoice.createdAt)}</td>
                    <td className="px-6 py-4 text-slate-300">{invoice.number || '—'}</td>
                    <td className="px-6 py-4 text-white">
                      {formatCurrency(invoice.amountPaid, invoice.currency)}
                    </td>
                    <td className="px-6 py-4">{getStatusBadge(invoice.status)}</td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-3">
                        {trustedInvoicePdfLink && (
                          <a
                            href={trustedInvoicePdfLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-slate-400 hover:text-white"
                            title="Download PDF"
                          >
                            <FileText className="h-4 w-4" />
                          </a>
                        )}
                        {trustedHostedInvoiceLink && (
                          <a
                            href={trustedHostedInvoiceLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-slate-400 hover:text-white"
                            title="View invoice"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
