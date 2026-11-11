import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { RightPanelTabs } from "./RightPanelTabs";

function render(technicalSurfacesAvailable: boolean | undefined) {
  return renderToStaticMarkup(
    <RightPanelTabs
      mode="inline"
      surfaces={[]}
      activeSurfaceId={null}
      pendingSurfaceIds={new Set()}
      previewSessions={{}}
      terminalLabelsById={new Map()}
      onActivate={vi.fn()}
      onCloseSurface={vi.fn()}
      onCloseOtherSurfaces={vi.fn()}
      onCloseSurfacesToRight={vi.fn()}
      onCloseAllSurfaces={vi.fn()}
      onCopyFilePath={vi.fn()}
      onAddBrowser={vi.fn()}
      onAddTerminal={vi.fn()}
      onAddDiff={vi.fn()}
      onAddFiles={vi.fn()}
      onAddAgents={vi.fn()}
      browserAvailable
      diffAvailable
      filesAvailable
      liveAgentCount={0}
      {...(technicalSurfacesAvailable === undefined ? {} : { technicalSurfacesAvailable })}
    >
      <div />
    </RightPanelTabs>,
  );
}

describe("right panel in office mode", () => {
  it("offers only the browser and file previews", () => {
    const markup = render(false);
    expect(markup).toContain("浏览器");
    expect(markup).toContain("文件");
    expect(markup).not.toContain("终端");
    expect(markup).not.toContain("变更");
    expect(markup).not.toContain("查看子 Agent");
  });

  it("offers every panel outside office mode", () => {
    const markup = render(undefined);
    for (const label of ["浏览器", "终端", "文件", "变更", "查看子 Agent"]) {
      expect(markup).toContain(label);
    }
  });
});
