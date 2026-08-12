import { EyeIcon, EyeOffIcon, LoaderCircleIcon, LogInIcon, RotateCcwIcon } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";

import fdsureMark from "../assets/fdsure-mark.png";
import fdsureWordmark from "../assets/fdsure-wordmark.png";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { useFdAccount } from "./FdAccountProvider";

export function FdLoginGate({ children }: { readonly children: ReactNode }) {
  const account = useFdAccount();

  if (account.state.status === "authenticated") return children;
  if (account.state.status === "checking") return <FdAccountChecking />;
  return <FdLoginScreen />;
}

function FdAccountChecking() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background text-foreground">
      <LoaderCircleIcon
        className="size-5 animate-spin text-muted-foreground"
        aria-label="正在检查账号"
      />
    </main>
  );
}

function FdLoginScreen() {
  const account = useFdAccount();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const pending = account.state.status === "revocation_pending";

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    account.clearError();
    const normalizedUsername = username.trim();
    if (normalizedUsername.length === 0 || password.length === 0) {
      setValidationError("请输入账号和密码。");
      return;
    }
    setValidationError(null);
    if (await account.login({ username: normalizedUsername, password })) setPassword("");
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-5 py-10 text-foreground">
      <section className="w-full max-w-sm" aria-labelledby="fd-login-title">
        <header className="mb-8 flex items-center gap-3">
          <img className="size-11 object-contain" src={fdsureMark} alt="" />
          <div className="min-w-0">
            <img
              className="h-5 max-w-36 object-contain object-left dark:brightness-0 dark:invert"
              src={fdsureWordmark}
              alt="方德"
            />
            <h1 id="fd-login-title" className="mt-1 text-lg font-semibold">
              方德 AI
            </h1>
          </div>
        </header>

        {pending ? (
          <div className="mb-5 border-l-2 border-amber-500 bg-amber-500/8 px-4 py-3" role="alert">
            <p className="text-sm font-medium">上次账号状态需要安全恢复</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{account.state.message}</p>
            <Button
              className="mt-3"
              size="sm"
              variant="outline"
              disabled={account.busy !== null}
              onClick={() => void account.retryRevocation()}
            >
              {account.busy === "retry" ? (
                <LoaderCircleIcon className="animate-spin" />
              ) : (
                <RotateCcwIcon />
              )}
              重试安全退出
            </Button>
          </div>
        ) : null}
        {pending ? (
          <p className="mb-4 text-sm leading-6 text-muted-foreground">
            也可以输入上次使用的员工账号，重新验证后继续登录。
          </p>
        ) : null}
        {
          <form className="space-y-4" onSubmit={(event) => void submit(event)}>
            <div className="space-y-1.5">
              <Label htmlFor="fd-account-username">员工账号</Label>
              <Input
                id="fd-account-username"
                nativeInput
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.currentTarget.value)}
                disabled={account.busy !== null}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fd-account-password">密码</Label>
              <div className="relative">
                <Input
                  id="fd-account-password"
                  nativeInput
                  className="pr-10"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.currentTarget.value)}
                  disabled={account.busy !== null}
                />
                <Button
                  className="absolute top-1/2 right-1 -translate-y-1/2"
                  size="icon-xs"
                  variant="ghost"
                  type="button"
                  aria-label={showPassword ? "隐藏密码" : "显示密码"}
                  onClick={() => setShowPassword((visible) => !visible)}
                >
                  {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                </Button>
              </div>
            </div>
            {(validationError ??
            account.error ??
            (account.state.status === "credentials_unavailable" ? account.state.message : null)) ? (
              <p className="text-sm leading-5 text-destructive" role="alert">
                {validationError ??
                  account.error ??
                  (account.state.status === "credentials_unavailable"
                    ? account.state.message
                    : null)}
              </p>
            ) : null}
            <Button className="w-full" size="lg" type="submit" disabled={account.busy !== null}>
              {account.busy === "login" ? (
                <LoaderCircleIcon className="animate-spin" />
              ) : (
                <LogInIcon />
              )}
              登录
            </Button>
            {account.state.status === "credentials_unavailable" ? (
              <Button
                className="w-full"
                type="button"
                variant="outline"
                disabled={account.busy !== null}
                onClick={() => void account.reload()}
              >
                {account.busy === "reload" ? (
                  <LoaderCircleIcon className="animate-spin" />
                ) : (
                  <RotateCcwIcon />
                )}
                刷新账号状态
              </Button>
            ) : null}
          </form>
        }
      </section>
    </main>
  );
}
