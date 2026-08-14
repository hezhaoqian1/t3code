import {
  ChartNoAxesColumnIcon,
  LoaderCircleIcon,
  LogOutIcon,
  PlugZapIcon,
  SettingsIcon,
} from "lucide-react";
import { memo, useCallback, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";

import { cn } from "../../lib/utils";
import {
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "../ui/sidebar";
import { SidebarUpdatePill } from "./SidebarUpdatePill";
import fdsureMark from "../../assets/fdsure-mark.png";
import { useFdAccount } from "../../fd/FdAccountProvider";

export const SidebarChromeHeader = memo(function SidebarChromeHeader({
  isElectron,
  endAction,
}: {
  isElectron: boolean;
  endAction?: ReactNode;
}) {
  return (
    <SidebarHeader
      className={cn(
        "@container/sidebar-header relative h-12 shrink-0 flex-row items-center gap-2 px-2 py-2",
        isElectron &&
          "drag-region h-[calc(var(--workspace-topbar-height)+2.75rem)] pb-2 pt-[var(--workspace-topbar-height)]",
      )}
    >
      <SidebarTrigger className="relative z-10 md:hidden" />
      <SidebarBrand />
      {endAction ? (
        <div className="relative z-10 ml-auto flex shrink-0 items-center [-webkit-app-region:no-drag]">
          {endAction}
        </div>
      ) : null}
    </SidebarHeader>
  );
});

function SidebarBrand() {
  return (
    <Link
      aria-label="返回任务列表"
      className="sidebar-brand relative z-10 h-9 min-w-0 items-center gap-2 overflow-hidden rounded-md px-1.5 text-sidebar-foreground outline-hidden ring-ring focus-visible:ring-2"
      to="/"
    >
      <img className="size-6 shrink-0 object-contain" src={fdsureMark} alt="" />
      <span className="truncate text-[15px] font-semibold">方德 AI</span>
    </Link>
  );
}

export const SidebarConnectorButton = memo(function SidebarConnectorButton() {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const { isMobile, setOpenMobile } = useSidebar();
  const handleConnectorsClick = useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
    void navigate({ to: "/connectors" });
  }, [isMobile, navigate, setOpenMobile]);

  return (
    <SidebarMenuButton
      isActive={pathname === "/connectors" || pathname.startsWith("/connectors/")}
      onClick={handleConnectorsClick}
    >
      <PlugZapIcon />
      <span>连接器</span>
    </SidebarMenuButton>
  );
});

export const SidebarChromeFooter = memo(function SidebarChromeFooter() {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const account = useFdAccount();
  const { isMobile, setOpenMobile } = useSidebar();
  const handleSettingsClick = useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
    void navigate({ to: "/settings" });
  }, [isMobile, navigate, setOpenMobile]);

  const handleUsageClick = useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
    void navigate({ to: "/usage" });
  }, [isMobile, navigate, setOpenMobile]);

  return (
    <SidebarFooter className="p-[var(--sidebar-content-inset)]">
      <SidebarUpdatePill />
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton isActive={pathname === "/usage"} onClick={handleUsageClick}>
            <ChartNoAxesColumnIcon />
            <span>用量统计</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={pathname === "/settings" || pathname.startsWith("/settings/")}
            onClick={handleSettingsClick}
          >
            <SettingsIcon />
            <span>设置</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            disabled={account.busy !== null}
            title={
              account.state.status === "authenticated" ? account.state.profile.username : undefined
            }
            onClick={() => void account.logout()}
          >
            {account.busy === "logout" ? (
              <LoaderCircleIcon className="animate-spin" />
            ) : (
              <LogOutIcon />
            )}
            <span>退出登录</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
  );
});
