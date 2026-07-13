import { useCallback, useState } from 'react';

export const useAppShellOverlayState = () => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isReportIssueOpen, setIsReportIssueOpen] = useState(false);
  const [isQuickSearchOpen, setQuickSearchOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [isAgentManagerOpen, setIsAgentManagerOpen] = useState(false);

  const closeQuickSearch = useCallback(() => {
    setQuickSearchOpen(false);
  }, []);

  const handleSearchClick = useCallback(() => {
    setQuickSearchOpen(true);
  }, []);

  const handleAgentManagerClick = useCallback(() => {
    setIsAgentManagerOpen(true);
  }, []);

  const handleMobileHamburgerClick = useCallback(() => {
    setIsSidebarOpen(true);
  }, []);

  const handleOpenReportIssue = useCallback(() => {
    setIsReportIssueOpen(true);
    setIsSidebarOpen(false);
  }, []);

  return {
    closeQuickSearch,
    handleAgentManagerClick,
    handleMobileHamburgerClick,
    handleOpenReportIssue,
    handleSearchClick,
    isAgentManagerOpen,
    isQuickSearchOpen,
    isReportIssueOpen,
    isShareModalOpen,
    isSidebarOpen,
    setIsReportIssueOpen,
    setIsAgentManagerOpen,
    setIsShareModalOpen,
    setIsSidebarOpen,
  };
};
