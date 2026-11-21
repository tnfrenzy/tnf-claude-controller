; TNF CLI — Inno Setup 6 script (Phase 5.6).
; Build: npm run package && npm run installer   (ISCC /DMyAppVersion=x.y.z installer\setup.iss)
; Installs per-user into %LOCALAPPDATA%\TNF\Controller (no admin). Claude Code CLI is NOT bundled.
;   {app}\app        runtime (node.exe, dist, ui, config, fixtures, tray.ps1) — replaced on upgrade/uninstall
;   {app}\data       SQLite DB, token, run artifacts   — kept on uninstall unless the user says otherwise
;   {app}\workspace  research runs + git worktrees     — idem
;   {app}\logs

#ifndef MyAppVersion
  #define MyAppVersion "0.0.0"
#endif
#define MyAppName "TNF CLI"
#define MyAppPublisher "TNF"
#define PS "{sys}\WindowsPowerShell\v1.0\powershell.exe"
; Doubled quotes survive into the [Icons]/[Registry] parameter strings as one literal quote each.
#define TrayArgs "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """"{app}\app\tray.ps1"""""

[Setup]
AppId={{7E1F3C2A-5B8D-4C61-9A0F-2D7B6E4C1F55}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\TNF\Controller
DisableProgramGroupPage=yes
DisableDirPage=no
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\build
OutputBaseFilename=TNF-CLI-Setup-{#MyAppVersion}
SetupIconFile=tnf.ico
UninstallDisplayIcon={app}\app\tnf.ico
UninstallDisplayName={#MyAppName}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=no

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
en.TaskAutostart=Khởi động cùng Windows (chạy nền ở khay hệ thống)
en.TaskDesktop=Tạo lối tắt trên màn hình nền
en.RunNow=Chạy {#MyAppName} ngay (biểu tượng ở khay hệ thống)
en.DemoShortcut={#MyAppName} (chế độ demo, không tốn hạn mức)
en.AskDeleteData=Xóa cả dữ liệu người dùng (lịch sử run, DB, worktree) trong%n%1 ?%n%nChọn No để giữ lại thư mục data và workspace.

[Tasks]
Name: "autostart"; Description: "{cm:TaskAutostart}"; Flags: unchecked
Name: "desktopicon"; Description: "{cm:TaskDesktop}"; Flags: unchecked

[Files]
Source: "..\build\app\*"; DestDir: "{app}\app"; Excludes: "config\controller.json,config\controller.default.json"; Flags: recursesubdirs ignoreversion
; Keep a user-edited controller.json (allowedOrigins, models...) across upgrades.
Source: "..\build\app\config\controller.json"; DestDir: "{app}\app\config"; Flags: onlyifdoesntexist uninsneveruninstall
; Always overwrite the defaults template: the [Code] step merges its new keys into the kept controller.json.
Source: "..\build\app\config\controller.default.json"; DestDir: "{app}\app\config"; Flags: ignoreversion

[Dirs]
Name: "{localappdata}\TNF\Controller\data"; Flags: uninsneveruninstall
Name: "{localappdata}\TNF\Controller\workspace"; Flags: uninsneveruninstall
Name: "{localappdata}\TNF\Controller\logs"; Flags: uninsneveruninstall

[InstallDelete]
; Clean up legacy shortcuts from older "TNF Claude Controller" installs on upgrade.
Type: files; Name: "{autoprograms}\TNF Claude Controller.lnk"
Type: files; Name: "{autoprograms}\TNF Claude Controller (chế độ demo, không tốn hạn mức).lnk"
Type: files; Name: "{autodesktop}\TNF Claude Controller.lnk"

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{#PS}"; Parameters: "{#TrayArgs}"; WorkingDir: "{app}\app"; IconFilename: "{app}\app\tnf.ico"; IconIndex: 0; Comment: "Chạy nền ở khay hệ thống, mở giao diện trong trình duyệt"
Name: "{autoprograms}\{cm:DemoShortcut}"; Filename: "{#PS}"; Parameters: "{#TrayArgs} -Demo"; WorkingDir: "{app}\app"; IconFilename: "{app}\app\tnf.ico"; IconIndex: 0
Name: "{autodesktop}\{#MyAppName}"; Filename: "{#PS}"; Parameters: "{#TrayArgs}"; WorkingDir: "{app}\app"; IconFilename: "{app}\app\tnf.ico"; IconIndex: 0; Tasks: desktopicon

[Registry]
; Remove legacy autostart entry name when upgrading from TNF Claude Controller.
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueName: "TNFClaudeController"; Flags: deletevalue
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "TNFCLI"; ValueData: """{#PS}"" {#TrayArgs}"; Flags: uninsdeletevalue; Tasks: autostart

[Run]
Filename: "{#PS}"; Parameters: "{#TrayArgs}"; WorkingDir: "{app}\app"; Description: "{cm:RunNow}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{#PS}"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\app\stop.ps1"""; Flags: runhidden waituntilterminated; RunOnceId: "StopTnf"

[Code]
var
  HadConfig: Boolean;

// Stop a running instance before files are replaced (upgrade / reinstall).
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  StopScript: String;
  ResultCode: Integer;
begin
  Result := '';
  // Remember whether a controller.json existed before [Files] runs (decides merge vs fresh install).
  HadConfig := FileExists(ExpandConstant('{app}\app\config\controller.json'));
  StopScript := ExpandConstant('{app}\app\stop.ps1');
  if FileExists(StopScript) then
    Exec(ExpandConstant('{#PS}'), '-NoProfile -ExecutionPolicy Bypass -File "' + StopScript + '"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

// After files are copied: merge new default keys into a kept controller.json. Failures are only logged.
procedure CurStepChanged(CurStep: TSetupStep);
var
  Cfg, Def, Node, Script: String;
  ResultCode: Integer;
begin
  if CurStep = ssPostInstall then begin
    Cfg := ExpandConstant('{app}\app\config\controller.json');
    Def := ExpandConstant('{app}\app\config\controller.default.json');
    if HadConfig then begin
      Node := ExpandConstant('{app}\app\node.exe');
      Script := ExpandConstant('{app}\app\dist\merge-config-cli.js');
      if FileExists(Node) and FileExists(Script) and FileExists(Def) then begin
        if not Exec(Node, '"' + Script + '" "' + Cfg + '" "' + Def + '"', ExpandConstant('{app}\app'), SW_HIDE, ewWaitUntilTerminated, ResultCode) then
          Log('controller.json merge: could not start node.exe, error ' + IntToStr(ResultCode) + '; existing file kept')
        else if ResultCode <> 0 then
          Log('controller.json merge failed, exit code ' + IntToStr(ResultCode) + '; existing file kept')
        else
          Log('controller.json merged with controller.default.json');
      end else
        Log('controller.json merge skipped: node.exe, merge-config-cli.js or controller.default.json missing');
    end else if not FileExists(Cfg) then begin
      // Safety net: the [Files] line normally already created it on a fresh install.
      if not FileCopy(Def, Cfg, False) then
        Log('controller.json could not be created from controller.default.json');
    end;
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Root: String;
begin
  if CurUninstallStep = usPostUninstall then begin
    // The runtime folder always goes (controller.json was marked uninsneveruninstall only to survive upgrades).
    DelTree(ExpandConstant('{app}\app'), True, True, True);
    // User data lives under %LOCALAPPDATA%\TNF\Controller even when app\ was installed elsewhere.
    Root := ExpandConstant('{localappdata}\TNF\Controller');
    if (not UninstallSilent) and (MsgBox(FmtMessage(CustomMessage('AskDeleteData'), [Root]), mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES) then begin
      DelTree(Root + '\data', True, True, True);
      DelTree(Root + '\workspace', True, True, True);
      DelTree(Root + '\logs', True, True, True);
    end;
    RemoveDir(ExpandConstant('{app}'));
    RemoveDir(Root);
    RemoveDir(ExpandConstant('{localappdata}\TNF'));
  end;
end;
