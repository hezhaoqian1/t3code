import {
  ChartNoAxesColumnIcon,
  LoaderCircleIcon,
  LogOutIcon,
  PlugZapIcon,
  SettingsIcon,
} from "lucide-react";
import { memo, useCallback } from "react";
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
import fdsureWordmark from "../../assets/fdsure-wordmark.png";
import { useFdAccount } from "../../fd/FdAccountProvider";

export const SidebarChromeHeader = memo(function SidebarChromeHeader({
  isElectron,
}: {
  isElectron: boolean;
}) {
  return (
    <SidebarHeader
      className={cn(
        "@container/sidebar-header relative h-[var(--workspace-topbar-height)] shrink-0 flex-row items-center px-3 py-0 md:px-0",
        isElectron && "drag-region",
      )}
    >
      <SidebarTrigger className="relative z-10 md:hidden" />
      <SidebarBrand />
    </SidebarHeader>
  );
});

function SidebarBrand() {
  return (
    <Link
      aria-label="返回任务列表"
      className={cn(
        "sidebar-brand relative z-10 ml-[var(--workspace-titlebar-content-left)] h-9 w-fit min-w-0 shrink-0 items-center overflow-hidden rounded-md outline-hidden ring-ring focus-visible:ring-2",
        "text-foreground",
      )}
      to="/"
    >
      <img
        className="h-6 w-auto max-w-32 object-contain dark:brightness-0 dark:invert"
        src={fdsureWordmark}
        alt="方德 AI"
      />
    </Link>
  );
}

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

  const handleConnectorsClick = useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
    void navigate({ to: "/connectors" });
  }, [isMobile, navigate, setOpenMobile]);

  return (
    <SidebarFooter className="p-[var(--sidebar-content-inset)]">
      <SidebarUpdatePill />
      <SidebarMenu>
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
            <span className="truncate">
              {account.state.status === "authenticated"
                ? (account.state.profile.displayName ?? account.state.profile.username)
                : "退出登录"}
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={pathname === "/connectors" || pathname.startsWith("/connectors/")}
            onClick={handleConnectorsClick}
          >
            <PlugZapIcon />
            <span>连接器</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
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
      </SidebarMenu>
    </SidebarFooter>
  );
});
