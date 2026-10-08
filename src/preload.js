const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {

resolveShippingExe: (exePath) => ipcRenderer.invoke('game:resolveShippingExe', { exePath }),
 
onUEVRInjectStatus: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('uevr:injectStatus', handler);
    return () => ipcRenderer.removeListener('uevr:injectStatus', handler);
},
// ── Display channels ──────────────────────────────────────────
listDisplayFamilies:       ()                          => ipcRenderer.invoke('display:listFamilies'),
getDisplayFamily:          (familyId)                  => ipcRenderer.invoke('display:getFamily',    { familyId }),
getDisplayDevice:          (familyId, deviceId)        => ipcRenderer.invoke('display:getDevice',    { familyId, deviceId }),
getAllDisplayDevices:       ()                          => ipcRenderer.invoke('display:getAllDevices'),

// ── Profile channels ──────────────────────────────────────────
// preview: resolve pipeline without writing anything — use to show user what will happen
previewProfile:            (fix, familyId, deviceId, options) =>
    ipcRenderer.invoke('profile:preview',            { fix, familyId, deviceId, options }),

// apply: resolve pipeline AND write config files (VRto3D, UEVR profile etc)
applyProfile:              (fix, familyId, deviceId, options) =>
    ipcRenderer.invoke('profile:apply',              { fix, familyId, deviceId, options }),

// software status: check which display-required software is installed
getDisplaySoftwareStatus:  (familyId, deviceId)        =>
    ipcRenderer.invoke('profile:getSoftwareStatus',  { familyId, deviceId }),
    // External software (NewAxis, vorpX, etc.)
    softwareCheck:         (softwareId)              => ipcRenderer.invoke('software:check', { softwareId }),
    softwareCheckForType:  (fixType)                 => ipcRenderer.invoke('software:checkForFixType', { fixType }),
    softwareLaunch:        (softwareId, exePath)     => ipcRenderer.invoke('software:launch', { softwareId, exePathOverride: exePath || null }),
 
    // ── UPDATE these two existing bindings to pass steamAppId ──────
    // Replace your current gameScan / gameScanAll lines with these:
    gameScan:    (title, exeName, steamAppId) => ipcRenderer.invoke('game:scan',    { title, exeName, steamAppId: steamAppId || null }),
    gameScanAll: (targets)                   => ipcRenderer.invoke('game:scanAll', { targets }),
 
    // Data
    loadGames:        () => ipcRenderer.invoke('games:loadAll'),
    loadPipelines:    () => ipcRenderer.invoke('pipelines:loadAll'),
    loadOutputs:      () => ipcRenderer.invoke('outputs:loadAll'),
    // Lazy-load: light sidebar projection + per-game detail fetch.
    loadGamesSidebar: ()    => ipcRenderer.invoke('games:loadSidebar'),
    loadGameOne:      (id)  => ipcRenderer.invoke('games:loadOne', { id }),
    loadDisplay:   (displayId) => ipcRenderer.invoke('displays:loadOne', { displayId }),
    launchWithUEVR: (exePath) => ipcRenderer.invoke('game:launchWithUEVR', { exePath }),

    // Display / monitor hardware settings
    displayGetSettings:  ()                                => ipcRenderer.invoke('display:getSettings'),
    displayWriteSetting: (profileId, settingId, value)    => ipcRenderer.invoke('display:writeSetting', { profileId, settingId, value }),

    // Installer
    installFix: (profile, gameId, gamePath, exeName) =>
        ipcRenderer.invoke('install:fix', { profile, gameId, gamePath, exeName }),
    installUEVRProfile: (profile) =>
        ipcRenderer.invoke('install:uevrProfile', { profile }),
    onInstallProgress: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('install:progress', handler);
        return () => ipcRenderer.removeListener('install:progress', handler);
    },

    // Uninstall
    uninstallFix: (profile, gamePath, options) =>
        ipcRenderer.invoke('install:uninstall', { profile, gamePath, options }),

    // Install state
    isInstalled:         (fixId) => ipcRenderer.invoke('install:isInstalled',    { fixId }),
    getInstallRecord:    (fixId) => ipcRenderer.invoke('install:getRecord',       { fixId }),
    getAllInstalled:      ()      => ipcRenderer.invoke('install:allInstalled'),
    getInstalledGameIds: ()      => ipcRenderer.invoke('install:installedGameIds'),

    // Launch
    launchGame: (exePath) => ipcRenderer.invoke('game:launch', { exePath }),

    // Pipeline executor (resolver-driven adapter dispatch — single call
    // replaces scattered per-tool config writes from the renderer).
    executePipeline: (input) => ipcRenderer.invoke('pipeline:execute', input),

    // ReShade — full set
    reshadeDetect:    (gamePath)                    => ipcRenderer.invoke('reshade:detect',            { gamePath }),
    reshadeStatus:      (gamePath, profile)           => ipcRenderer.invoke('reshade:status',            { gamePath, profile }),
    reshadeUpdatePreset:(gamePath, shaders)           => ipcRenderer.invoke('reshade:updatePreset',      { gamePath, shaders }),
    reshadeDetectApi: (gamePath, exePath, profile)  => ipcRenderer.invoke('reshade:detectApi',         { gamePath, exePath, profile }),
    reshadeGetShaders:(steps)                       => ipcRenderer.invoke('reshade:shadersForPipeline', { steps }),
    reshadeInstall:   (gamePath, exePath, profile, requiredShaders, geo11Installed) =>
        ipcRenderer.invoke('reshade:install', { gamePath, exePath, profile, requiredShaders, geo11Installed }),
    onReshadeProgress: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('reshade:progress', handler);
        return () => ipcRenderer.removeListener('reshade:progress', handler);
    },

    // Cache
    getCacheInfo: () => ipcRenderer.invoke('install:cacheInfo'),
    clearCache:   () => ipcRenderer.invoke('install:clearCache'),

    // Ini editor
    iniGetState: (fixId, iniPath)         => ipcRenderer.invoke('ini:getState',  { fixId, iniPath }),
    iniApply:    (fixId, iniPath, values) => ipcRenderer.invoke('ini:apply',     { fixId, iniPath, values }),
    reshadeIniPatch: (iniPath, section, patches) => ipcRenderer.invoke('reshade:iniPatch', { iniPath, section, patches }),
    reshadeToggle3DGameBridge: (gamePath, enabled) => ipcRenderer.invoke('reshade:toggle3DGameBridge', { gamePath, enabled }),
    reshadeEnsureVRServer: () => ipcRenderer.invoke('reshade:ensureVRServer'),
    // UE3D / UEVR
    installUE3D:      (profile, gamePath, exeName)  => ipcRenderer.invoke('install:ue3d',      { profile, gamePath, exeName }),
    uevrReadConfig:   (exeName)                     => ipcRenderer.invoke('uevr:readConfig',    { exeName }),
    uevrWriteConfig:  (exeName, values)             => ipcRenderer.invoke('uevr:writeConfig',   { exeName, values }),
    uevrWriteAutoConfig: (gameName, config)         => ipcRenderer.invoke('uevr:writeAutoConfig', { gameName, config }),
    writeGameMarker:  (gameName)                    => ipcRenderer.invoke('uevr:writeGameMarker', { gameName }),
    vrto3dReadConfig: ()                            => ipcRenderer.invoke('vrto3d:readConfig'),
    vrto3dWriteConfig:(values)                      => ipcRenderer.invoke('vrto3d:writeConfig', { values }),
    vrto3dWriteGameProfile: (exeName, settings)    => ipcRenderer.invoke('vrto3d:writeGameProfile', { exeName, settings }),
    vrto3dIsInstalled: ()                           => ipcRenderer.invoke('vrto3d:isInstalled'),
    vrto3dInstall: (force)                          => ipcRenderer.invoke('vrto3d:install', { force }),
    setInstallExtra:  (fixId, extra)               => ipcRenderer.invoke('installState:setExtra', { fixId, extra }),
    sendKeys: (keys, delayMs) => ipcRenderer.invoke('launch:sendKeys', { keys, delayMs }),
    iniReset:    (fixId, iniPath)         => ipcRenderer.invoke('ini:reset',     { fixId, iniPath }),
    iniSnapshot: (fixId, iniPath)         => ipcRenderer.invoke('ini:snapshot',  { fixId, iniPath }),

    // External / dialog
    openExternal:        (url) => ipcRenderer.invoke('shell:openExternal', url),
    openUrl:             (url) => ipcRenderer.invoke('shell:openExternal', url),
    openLocalPath:       (p)   => ipcRenderer.invoke('shell:openPath', p),
    openDirectoryDialog: ()    => ipcRenderer.invoke('dialog:openDirectory'),

    // Window controls
    minimizeWindow: () => ipcRenderer.send('window:minimize'),
    maximizeWindow: () => ipcRenderer.send('window:maximize'),
    closeWindow:    () => ipcRenderer.send('window:close'),
    openOpenTrackHub: () => ipcRenderer.invoke('opentrack:open'),
    getAppVersion:    () => ipcRenderer.invoke('app:version'),
});