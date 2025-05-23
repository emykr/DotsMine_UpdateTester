/**
 * Script for landing.ejs
 */
// Requirements
const { URL }                 = require('url')
const {
    MojangRestAPI,
    getServerStatus
}                             = require('helios-core/mojang')
const {
    RestResponseStatus,
    isDisplayableError,
    validateLocalFile
}                             = require('helios-core/common')
const {
    FullRepair,
    DistributionIndexProcessor,
    MojangIndexProcessor,
    downloadFile
}                             = require('helios-core/dl')
const {
    validateSelectedJvm,
    ensureJavaDirIsRoot,
    javaExecFromRoot,
    discoverBestJvmInstallation,
    latestOpenJDK,
    extractJdk
}                             = require('helios-core/java')

// Internal Requirements
const DiscordWrapper          = require('./assets/js/discordwrapper')
const ProcessBuilder          = require('./assets/js/processbuilder')

// Launch Elements
const launch_content          = document.getElementById('launch_content')
const launch_details          = document.getElementById('launch_details')
const launch_progress         = document.getElementById('launch_progress')
const launch_progress_label   = document.getElementById('launch_progress_label')
const launch_details_text     = document.getElementById('launch_details_text')
const server_selection_button = document.getElementById('server_selection_button')
const user_text               = document.getElementById('user_text')

const loggerLanding = LoggerUtil.getLogger('Landing')

/* Launch Progress Wrapper Functions */

/**
 * Show/hide the loading area.
 * 
 * @param {boolean} loading True if the loading area should be shown, otherwise false.
 */
function toggleLaunchArea(loading){
    if(loading){
        launch_details.style.display = 'flex'
        launch_content.style.display = 'none'
    } else {
        launch_details.style.display = 'none'
        launch_content.style.display = 'inline-flex'
    }
}

/**
 * Set the details text of the loading area.
 * 
 * @param {string} details The new text for the loading details.
 */
function setLaunchDetails(details){
    launch_details_text.innerHTML = details
}

/**
 * Set the value of the loading progress bar and display that value.
 * 
 * @param {number} percent Percentage (0-100)
 */
function setLaunchPercentage(percent) {
    // 기본 진행률 표시
    launch_progress.setAttribute('max', 100)
    launch_progress.setAttribute('value', percent)
    launch_progress_label.innerHTML = percent + '%'
    
    // 마스킹 프로그래스바 업데이트 - CSS 그라데이션
    const progressMask = document.getElementById('progress-mask')
    if(progressMask) {
        progressMask.style.width = percent + '%'
        progressMask.style.transition = 'width 0.8s cubic-bezier(0.4, 0.0, 0.2, 1)'
    }
}

function setDownloadPercentage(percent) {
    // OS 작업표시줄 진행률
    remote.getCurrentWindow().setProgressBar(percent/100)
    
    // 프로그래스 마스크 업데이트 - CSS 그라데이션
    const progressMask = document.getElementById('progress-mask')
    if(progressMask) {
        progressMask.style.width = percent + '%'
        progressMask.style.transition = 'width 0.8s cubic-bezier(0.4, 0.0, 0.2, 1)'
    }
}

/**
 * Enable or disable the launch button.
 * 
 * @param {boolean} val True to enable, false to disable.
 */
function setLaunchEnabled(val) {
    const startButton = document.getElementById('start_button')
    if(startButton) {
        startButton.disabled = !val
        if(val) {
            startButton.classList.remove('loading')
            startButton.classList.remove('error')
            const progressFill = startButton.querySelector('.progress-fill')
            if(progressFill) {
                progressFill.style.width = '0%'
            }
        }
    }
}

// Enable/disable start button based on server selection
function setStartButtonEnabled(enabled) {
    const startButton = document.getElementById('start_button')
    if(startButton) {
        startButton.disabled = !enabled
        startButton.style.opacity = enabled ? '1' : '0.5'
        startButton.style.cursor = enabled ? 'pointer' : 'not-allowed'
        
        if(!enabled) {
            startButton.classList.remove('loading')
            const progressFill = startButton.querySelector('.progress-fill')
            if(progressFill) {
                progressFill.style.width = '0%'
            }
        }
    }
}



async function startGame() {
    // 실행 중이거나 시작 중이면 중복 실행 대화상자 표시
    if(proc != null || isLaunching) {
        loggerLandingUI.warn('Game is already running')
        
        // 중복 실행 확인 대화상자 표시
        setOverlayContent(
            Lang.queryJS('landing.launch.alreadyRunningTitle'),
            Lang.queryJS('landing.launch.alreadyRunningText'),
            Lang.queryJS('landing.launch.alreadyRunningConfirm'),
            Lang.queryJS('landing.launch.alreadyRunningCancel')
        )
        
        // 확인 버튼 클릭 시 무시하고 실행
        setOverlayHandler(() => {
            toggleOverlay(false)
            proceedWithLaunch()
        })
        
        // 취소 버튼 클릭 시 대화상자만 닫기
        setDismissHandler(() => {
            toggleOverlay(false, true)
        })
        
        toggleOverlay(true, true)
        return
    }

    // 자바 실행 파일 체크
    const server = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())
    const javaExec = ConfigManager.getJavaExecutable(server.rawServer.id)

    if(!javaExec) {
        // 자바 자동 검색
        const jvmDetails = await discoverBestJvmInstallation(
            ConfigManager.getDataDirectory(),
            server.effectiveJavaOptions.supported
        )

        if(jvmDetails != null) {
            // 자바 찾음 - 설정 저장
            const foundJavaExec = javaExecFromRoot(jvmDetails.path)
            ConfigManager.setJavaExecutable(server.rawServer.id, foundJavaExec)
            ConfigManager.save()
            
            // 게임 시작 진행
            proceedWithLaunch()
        } else {
            // 자바 못찾음 - 설정으로 이동
            setOverlayContent(
                '자바를 찾을 수 없습니다',
                '게임 실행을 위해 자바를 설정해야 합니다.<br>설정 화면으로 이동합니다.',
                '확인'
            )
            setOverlayHandler(() => {
                toggleOverlay(false)
                switchView(getCurrentView(), VIEWS.settings)
                settingsNavItemListener(document.getElementById('settingsNavJava'))
            })
            toggleOverlay(true)
            return
        }
    } else {
        // 자바 있음 - 게임 시작
        proceedWithLaunch()
    }
}

// 실제 게임 실행 로직을 proceedWithLaunch 함수로 분리
function proceedWithLaunch() {
    isLaunching = true
    // UI 상태 전환 함수 사용
    toggleGameUI(true)
    dlAsync()
}

const MIN_LINGER = 5000
const minDuration = 1000

// Game execution status variables
// UI 상태 전환 함수 추가
let proc = null
let isLaunching = false

const loggerLandingUI = LoggerUtil.getLogger('LandingUI')

// 시작 버튼 클릭 이벤트 리스너
const start_button = document.getElementById('start_button')
if(start_button) {
    start_button.onclick = async () => {
        loggerLandingUI.info('Start button clicked')
        await startGame()
    }
}

// UI 상태 전환 함수
function toggleGameUI(loading) {
    const playButtonContainer = document.getElementById('playButtonContainer')
    const playMaskContainer = document.getElementById('playMaskContainer')
    const progressMask = document.getElementById('progress-mask')
    const startButton = document.getElementById('start_button')

    loggerLandingUI.info(`UI 상태 전환: ${loading ? '로딩' : '시작 버튼'}으로 전환`)

    if(loading) {
        // 로딩 UI로 전환
        if(playButtonContainer) {
            playButtonContainer.style.visibility = 'hidden'
        }
        if(playMaskContainer) {
            playMaskContainer.style.visibility = 'visible'
        }
        if(progressMask) {
            progressMask.style.width = '0%'
        }
        if(startButton) {
            startButton.disabled = true
        }

        // 기존 15초 후 복귀 코드 백업
        /*
        setTimeout(() => {
            if(playMaskContainer) {
                playMaskContainer.style.visibility = 'hidden'
            }
            if(playButtonContainer) {
                playButtonContainer.style.visibility = 'visible'
                playButtonContainer.style.opacity = '1'
            }
            if(progressMask) {
                progressMask.style.width = '0%'
            }
            if(startButton) {
                startButton.disabled = false
            }
        }, 15000) // 15초
        */
    } else {
        // 시작 버튼으로 복귀
        if(playMaskContainer) {
            playMaskContainer.style.visibility = 'hidden'
        }
        if(playButtonContainer) {
            playButtonContainer.style.visibility = 'visible'
        }
        if(progressMask) {
            progressMask.style.width = '0%'
        }
        if(startButton) {
            startButton.disabled = false 
        }
    }
}

// 로딩바가 100%가 되면 시작버튼 복귀
const originalSetLaunchPercentage = setLaunchPercentage
setLaunchPercentage = function(percent) {
    originalSetLaunchPercentage(percent)
}

// 게임 종료/로딩 완료 핸들러
function onGameLaunchComplete() {
    isLaunching = false
    remote.getCurrentWindow().setProgressBar(-1)

    loggerLandingUI.info('onGameLaunchComplete called')

    // UI 상태 전환 함수 호출
    toggleGameUI(false)
}

function bindProcCloseEvent() {
    if(proc && proc.on) {
        proc.on('close', () => {
            loggerLandingUI.info('proc.on(close) called')
            if(hasRPC) {
                loggerLaunchSuite.info('Shutting down Discord Rich Presence..')
                DiscordWrapper.shutdownRPC()
                hasRPC = false
            }
            proc = null 
            isLaunching = false

            // UI 복구
            const start_button = document.getElementById('start_button')
            const playMaskContainer = document.getElementById('playMaskContainer')

            if(playMaskContainer) {
                loggerLandingUI.info('Hiding playMaskContainer (proc close)')
                playMaskContainer.style.visibility = 'hidden'
            }

            // 3~5초 후에 시작 버튼 표시
            const delay = Math.random() * (5000 - 3000) + 3000
            loggerLandingUI.info(`Will show start_button after ${delay}ms (proc close)`)
            setTimeout(() => {
                if(start_button) {
                    loggerLandingUI.info('Showing start_button (proc close)')
                    start_button.style.visibility = 'visible'
                    start_button.style.opacity = '1'
                    start_button.disabled = false
                } else {
                    loggerLandingUI.warn('start_button not found in setTimeout (proc close)')
                }
            }, delay)

            remote.getCurrentWindow().setProgressBar(-1)
        })
    }
}



// 선택된 계정 정보 업데이트
function updateSelectedAccount(authUser){
    // 계정이 선택되지 않은 경우 기본 텍스트 표시
    let username = Lang.queryJS('landing.selectedAccount.noAccountSelected')
    
    // 계정 정보가 있는 경우
    if(authUser != null){
        if(authUser.displayName != null){
            username = authUser.displayName
        }
        // 아바타 이미지 업데이트 (컨테이너가 존재하는 경우에만)
        const avatarContainer = document.getElementById('avatarContainer')
        if(authUser.uuid != null && avatarContainer){
            avatarContainer.style.backgroundImage = `url('https://mc-heads.net/body/${authUser.uuid}/right')`
        }
    }
    
    // 사용자 이름 텍스트 업데이트 (요소가 존재하는 경우에만)
    const userTextElement = document.getElementById('user_text')
    if(userTextElement) {
        userTextElement.innerHTML = username
    }
}

// 현재 선택된 계정으로 UI 업데이트
updateSelectedAccount(ConfigManager.getSelectedAccount())

// Bind selected server
function updateSelectedServer(serv){
    if(getCurrentView() === VIEWS.settings){
        fullSettingsSave()
    }
    ConfigManager.setSelectedServer(serv != null ? serv.rawServer.id : null)
    ConfigManager.save()
    server_selection_button.innerHTML = '&#8226; ' + (serv != null ? serv.rawServer.name : Lang.queryJS('landing.noSelection'))
    if(getCurrentView() === VIEWS.settings){
        animateSettingsTabRefresh()
    }
    setStartButtonEnabled(serv != null)
}
// Real text is set in uibinder.js on distributionIndexDone.
server_selection_button.innerHTML = '&#8226; ' + Lang.queryJS('landing.selectedServer.loading')
server_selection_button.onclick = async e => {
    e.target.blur()
    await toggleServerSelection(true)
}

// Update Mojang Status Color
const refreshMojangStatuses = async function(){
    loggerLanding.info('Refreshing Mojang Statuses..')

    let status = 'grey'
    let tooltipEssentialHTML = ''
    let tooltipNonEssentialHTML = ''

    const response = await MojangRestAPI.status()
    let statuses
    if(response.responseStatus === RestResponseStatus.SUCCESS) {
        statuses = response.data
    } else {
        loggerLanding.warn('Unable to refresh Mojang service status.')
        statuses = MojangRestAPI.getDefaultStatuses()
    }
    
    greenCount = 0
    greyCount = 0

    for(let i=0; i<statuses.length; i++){
        const service = statuses[i]

        const tooltipHTML = `<div class="mojangStatusContainer">
            <span class="mojangStatusIcon" style="color: ${MojangRestAPI.statusToHex(service.status)};">&#8226;</span>
            <span class="mojangStatusName">${service.name}</span>
        </div>`
        if(service.essential){
            tooltipEssentialHTML += tooltipHTML
        } else {
            tooltipNonEssentialHTML += tooltipHTML
        }

        if(service.status === 'yellow' && status !== 'red'){
            status = 'yellow'
        } else if(service.status === 'red'){
            status = 'red'
        } else {
            if(service.status === 'grey'){
                ++greyCount
            }
            ++greenCount
        }

    }

    if(greenCount === statuses.length){
        if(greyCount === statuses.length){
            status = 'grey'
        } else {
            status = 'green'
        }
    }
    
    document.getElementById('mojangStatusEssentialContainer').innerHTML = tooltipEssentialHTML
    document.getElementById('mojangStatusNonEssentialContainer').innerHTML = tooltipNonEssentialHTML
    document.getElementById('mojang_status_icon').style.color = MojangRestAPI.statusToHex(status)
}

const refreshServerStatus = async (fade = false) => {
    loggerLanding.info('Refreshing Server Status')
    const serv = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())

    let pLabel = Lang.queryJS('landing.serverStatus.server')
    let pVal = Lang.queryJS('landing.serverStatus.offline')
    let servStat = null

    try {
        servStat = await getServerStatus(47, serv.hostname, serv.port)
        // 디버그 로그 추가
        loggerLanding.debug('Server Status Response:', servStat)
        loggerLanding.debug('Server Players:', servStat.players)
        loggerLanding.debug('Is Online:', !!(servStat && servStat.players))
        
        pLabel = Lang.queryJS('landing.serverStatus.players')
        pVal = servStat.players.online + '/' + servStat.players.max

    } catch (err) {
        loggerLanding.warn('Unable to refresh server status, assuming offline.')
        loggerLanding.debug('Error details:', err)
        servStat = null
    }
    
    // 이미지 변경 전 상태 로깅
    const serverImg = document.getElementById('serverStatus') // 'server-status'에서 'serverStatus'로 수정
    loggerLanding.debug('Current image path:', serverImg ? serverImg.src : 'Image element not found')
    loggerLanding.debug('Will change to:', servStat && servStat.players ? 'server_on.png' : 'server_off.png')
    
    if(fade){
        $('#serverStatusContainer').fadeOut(250, () => { // jQuery selector도 수정
            if(serverImg) {
                serverImg.src = servStat && servStat.players ? './assets/images/duckarmri/server_on.png' : './assets/images/duckarmri/server_off.png'
                loggerLanding.debug('Image changed to:', serverImg.src)
            }
            $('#serverStatusContainer').fadeIn(500)
        })
    } else {
        if(serverImg) {
            serverImg.src = servStat && servStat.players ? './assets/images/duckarmri/server_on.png' : './assets/images/duckarmri/server_off.png'
            loggerLanding.debug('Image changed to:', serverImg.src)
        }
    }
}

refreshMojangStatuses()
// Server Status is refreshed in uibinder.js on distributionIndexDone.

// Refresh statuses every hour. The status page itself refreshes every day so...
let mojangStatusListener = setInterval(() => refreshMojangStatuses(true), 60*60*1000)
// Set refresh rate to once every 5 minutes.
let serverStatusListener = setInterval(() => refreshServerStatus(true), 300000)

/**
 * Shows an error overlay, toggles off the launch area.
 * 
 * @param {string} title The overlay title.
 * @param {string} desc The overlay description.
 */
function showLaunchFailure(title, desc){
    setOverlayContent(
        title,
        desc,
        Lang.queryJS('landing.launch.okay')
    )
    setOverlayHandler(null)
    toggleOverlay(true)
    toggleLaunchArea(false)
    
    // 에러 상태 표시
    const startButton = document.querySelector('.start-button')
    if(startButton) {
        startButton.classList.add('error')
    }
}

/* System (Java) Scan */

/**
 * Asynchronously scan the system for valid Java installations.
 * 
 * @param {boolean} launchAfter Whether we should begin to launch after scanning. 
 */
async function asyncSystemScan(effectiveJavaOptions, launchAfter = true){

    setLaunchDetails(Lang.queryJS('landing.systemScan.checking'))
    toggleLaunchArea(true)
    setLaunchPercentage(0, 100)

    const jvmDetails = await discoverBestJvmInstallation(
        ConfigManager.getDataDirectory(),
        effectiveJavaOptions.supported
    )

    if(jvmDetails == null) {
        // If the result is null, no valid Java installation was found.
        // Show this information to the user.
        setOverlayContent(
            Lang.queryJS('landing.systemScan.noCompatibleJava'),
            Lang.queryJS('landing.systemScan.installJavaMessage', { 'major': effectiveJavaOptions.suggestedMajor }),
            Lang.queryJS('landing.systemScan.installJava'),
            Lang.queryJS('landing.systemScan.installJavaManually')
        )
        setOverlayHandler(() => {
            setLaunchDetails(Lang.queryJS('landing.systemScan.javaDownloadPrepare'))
            toggleOverlay(false)
            
            try {
                downloadJava(effectiveJavaOptions, launchAfter)
            } catch(err) {
                loggerLanding.error('Unhandled error in Java Download', err)
                showLaunchFailure(Lang.queryJS('landing.systemScan.javaDownloadFailureTitle'), Lang.queryJS('landing.systemScan.javaDownloadFailureText'))
            }
        })
        setDismissHandler(() => {
            $('#overlayContent').fadeOut(250, () => {
                //$('#overlayDismiss').toggle(false)
                setOverlayContent(
                    Lang.queryJS('landing.systemScan.javaRequired', { 'major': effectiveJavaOptions.suggestedMajor }),
                    Lang.queryJS('landing.systemScan.javaRequiredMessage', { 'major': effectiveJavaOptions.suggestedMajor }),
                    Lang.queryJS('landing.systemScan.javaRequiredDismiss'),
                    Lang.queryJS('landing.systemScan.javaRequiredCancel')
                )
                setOverlayHandler(() => {
                    toggleLaunchArea(false)
                    toggleOverlay(false)
                })
                setDismissHandler(() => {
                    toggleOverlay(false, true)

                    asyncSystemScan(effectiveJavaOptions, launchAfter)
                })
                $('#overlayContent').fadeIn(250)
            })
        })
        toggleOverlay(true, true)
    } else {
        // Java installation found, use this to launch the game.
        const javaExec = javaExecFromRoot(jvmDetails.path)
        ConfigManager.setJavaExecutable(ConfigManager.getSelectedServer(), javaExec)
        ConfigManager.save()

        // We need to make sure that the updated value is on the settings UI.
        // Just incase the settings UI is already open.
        settingsJavaExecVal.value = javaExec
        await populateJavaExecDetails(settingsJavaExecVal.value)

        // TODO Callback hell, refactor
        // TODO Move this out, separate concerns.
        if(launchAfter){
            await dlAsync()
        }
    }

}

async function downloadJava(effectiveJavaOptions, launchAfter = true) {

    // TODO Error handling.
    // asset can be null.
    const asset = await latestOpenJDK(
        effectiveJavaOptions.suggestedMajor,
        ConfigManager.getDataDirectory(),
        effectiveJavaOptions.distribution)

    if(asset == null) {
        throw new Error(Lang.queryJS('landing.downloadJava.findJdkFailure'))
    }

    let received = 0
    await downloadFile(asset.url, asset.path, ({ transferred }) => {
        received = transferred
        setDownloadPercentage(Math.trunc((transferred/asset.size)*100))
    })
    setDownloadPercentage(100)

    if(received != asset.size) {
        loggerLanding.warn(`Java Download: Expected ${asset.size} bytes but received ${received}`)
        if(!await validateLocalFile(asset.path, asset.algo, asset.hash)) {
            log.error(`Hashes do not match, ${asset.id} may be corrupted.`)
            // Don't know how this could happen, but report it.
            throw new Error(Lang.queryJS('landing.downloadJava.javaDownloadCorruptedError'))
        }
    }

    // Extract
    // Show installing progress bar.
    remote.getCurrentWindow().setProgressBar(2)

    // Wait for extration to complete.
    const eLStr = Lang.queryJS('landing.downloadJava.extractingJava')
    let dotStr = ''
    setLaunchDetails(eLStr)
    const extractListener = setInterval(() => {
        if(dotStr.length >= 3){
            dotStr = ''
        } else {
            dotStr += '.'
        }
        setLaunchDetails(eLStr + dotStr)
    }, 750)

    const newJavaExec = await extractJdk(asset.path)

    // Extraction complete, remove the loading from the OS progress bar.
    remote.getCurrentWindow().setProgressBar(-1)

    // Extraction completed successfully.
    ConfigManager.setJavaExecutable(ConfigManager.getSelectedServer(), newJavaExec)
    ConfigManager.save()

    clearInterval(extractListener)
    setLaunchDetails(Lang.queryJS('landing.downloadJava.javaInstalled'))

    // TODO Callback hell
    // Refactor the launch functions
    asyncSystemScan(effectiveJavaOptions, launchAfter)

}

// Keep reference to Minecraft Process
// Is DiscordRPC enabled
let hasRPC = false
// Joined server regex
// Change this if your server uses something different.
const GAME_JOINED_REGEX = /\[.+\]: Sound engine started/
const GAME_LAUNCH_REGEX = /(ModLauncher .*starting:|ModLauncher running: args)/i

const tempListener = function(data){
    console.log('[DEBUG] tempListener data:', data)
    if(GAME_LAUNCH_REGEX.test(data.trim())){
        console.log('[DEBUG] GAME_LAUNCH_REGEX matched!')
        const diff = Date.now()-start
        if(diff < MIN_LINGER) {
            setTimeout(() => {
                onLoadComplete()
            }, MIN_LINGER-diff)
        } else {
            onLoadComplete()
        }
    }
}


async function dlAsync(login = true) {
    const loggerLaunchSuite = LoggerUtil.getLogger('LaunchSuite')

    setLaunchDetails(Lang.queryJS('landing.dlAsync.loadingServerInfo')) 
    toggleLaunchArea(true)
    setLaunchPercentage(0, 100)

    let distro

    try {
        distro = await DistroAPI.refreshDistributionOrFallback()
        onDistroRefresh(distro)
    } catch(err) {
        loggerLaunchSuite.error('Unable to refresh distribution index.', err)
        showLaunchFailure(Lang.queryJS('landing.dlAsync.fatalError'), Lang.queryJS('landing.dlAsync.unableToLoadDistributionIndex'))
        return
    }

    const serv = distro.getServerById(ConfigManager.getSelectedServer())

    if(login) {
        if(ConfigManager.getSelectedAccount() == null){
            loggerLanding.error('You must be logged into an account.')
            return
        }
    }

    setLaunchDetails(Lang.queryJS('landing.dlAsync.pleaseWait'))
    toggleLaunchArea(true)
    setLaunchPercentage(0, 100)

    const startTime = Date.now()

    const fullRepairModule = new FullRepair(
        ConfigManager.getCommonDirectory(),
        ConfigManager.getInstanceDirectory(),
        ConfigManager.getLauncherDirectory(),
        ConfigManager.getSelectedServer(),
        DistroAPI.isDevMode()
    )

    fullRepairModule.spawnReceiver()

    fullRepairModule.childProcess.on('error', (err) => {
        loggerLaunchSuite.error('Error during launch', err)
        showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), err.message || Lang.queryJS('landing.dlAsync.errorDuringLaunchText'))
    })
    fullRepairModule.childProcess.on('close', (code, _signal) => {
        if(code !== 0){
            loggerLaunchSuite.error(`Full Repair Module exited with code ${code}, assuming error.`)
            showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), Lang.queryJS('landing.dlAsync.seeConsoleForDetails'))
        }
    })

    loggerLaunchSuite.info('Validating files.')
    setLaunchDetails(Lang.queryJS('landing.dlAsync.validatingFileIntegrity'))
    let invalidFileCount = 0
    try {
        invalidFileCount = await fullRepairModule.verifyFiles(percent => {
            setLaunchPercentage(percent)
        })
        // 검증이 너무 빨리 끝나면 자연스러운 애니메이션 추가
        const elapsed = Date.now() - startTime
        const minDuration = 1000 // 최소 1초
        if (elapsed < minDuration) {
            const step = 5
            for (let p = 0; p <= 100; p += step) {
                setLaunchPercentage(p)
                await new Promise(res => setTimeout(res, (minDuration - elapsed) / (100 / step)))
            }
        }
    } catch (err) {
        loggerLaunchSuite.error('Error during file validation.')
        showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringFileVerificationTitle'), err.displayable || Lang.queryJS('landing.dlAsync.seeConsoleForDetails'))
        return
    }

    if(invalidFileCount > 0) {
        loggerLaunchSuite.info('Downloading files.')
        setLaunchDetails(Lang.queryJS('landing.dlAsync.downloadingFiles'))
        setLaunchPercentage(0)
        try {
            const dlStartTime = Date.now()
            await fullRepairModule.download(percent => {
                setDownloadPercentage(percent)
            })
            // 다운로드가 너무 빨리 끝나면 자연스러운 애니메이션 추가
            const dlElapsed = Date.now() - dlStartTime
            if (dlElapsed < minDuration) {
                const step = 5
                for (let p = 0; p <= 100; p += step) {
                    setDownloadPercentage(p)
                    await new Promise(res => setTimeout(res, (minDuration - dlElapsed) / (100 / step)))
                }
            }
        } catch(err) {
            loggerLaunchSuite.error('Error during file download.')
            showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringFileDownloadTitle'), err.displayable || Lang.queryJS('landing.dlAsync.seeConsoleForDetails'))
            return
        }
    } else {
        loggerLaunchSuite.info('No invalid files, skipping download.')
        // 다운로드를 건너뛰어도 자연스러운 로딩 애니메이션 추가
        const elapsed = Date.now() - startTime
        const minDuration = 1000
        if (elapsed < minDuration) {
            const step = 5
            for (let p = 0; p <= 100; p += step) {
                setDownloadPercentage(p)
                await new Promise(res => setTimeout(res, (minDuration - elapsed) / (100 / step)))
            }
        }
    }

    // Remove download bar.
    remote.getCurrentWindow().setProgressBar(-1)

    fullRepairModule.destroyReceiver()

    setLaunchDetails(Lang.queryJS('landing.dlAsync.preparingToLaunch'))

    try {
        const mojangIndexProcessor = new MojangIndexProcessor(
            ConfigManager.getCommonDirectory(),
            serv.rawServer.minecraftVersion)
        const distributionIndexProcessor = new DistributionIndexProcessor(
            ConfigManager.getCommonDirectory(),
            distro,
            serv.rawServer.id
        )

        const modLoaderData = await distributionIndexProcessor.loadModLoaderVersionJson(serv)
        const versionData = await mojangIndexProcessor.getVersionJson()

        if(login) {
            const authUser = ConfigManager.getSelectedAccount()
            loggerLaunchSuite.info(`Sending selected account (${authUser.displayName}) to ProcessBuilder.`)
            let pb = new ProcessBuilder(serv, versionData, modLoaderData, authUser, remote.app.getVersion())
            setLaunchDetails(Lang.queryJS('landing.dlAsync.launchingGame'))

            const SERVER_JOINED_REGEX = new RegExp(`\\[.+\\]: \\[CHAT\\] ${authUser.displayName} joined the game`)

            const onLoadComplete = () => {
                console.log('[DEBUG] onLoadComplete 호출됨')
                toggleLaunchArea(false)
                if(hasRPC){
                    DiscordWrapper.updateDetails(Lang.queryJS('landing.discord.loading'))
                    proc.stdout.on('data', gameStateChange)
                    proc.stdout.on('data', tempListener)
                    console.log('[DEBUG] tempListener 바인딩 완료')
                }
                proc.stdout.removeListener('data', tempListener)
                proc.stderr.removeListener('data', gameErrorListener)
                
                // UI 상태를 즉시 업데이트
                onGameLaunchComplete()
                
                // 3초 후에 강제로 UI 상태 확인 및 업데이트
                setTimeout(() => {
                    const playMaskContainer = document.getElementById('playMaskContainer')
                    const playButtonContainer = document.getElementById('playButtonContainer')
                    
                    if(playMaskContainer && playMaskContainer.style.visibility !== 'hidden') {
                        loggerLandingUI.info('Force hiding loading UI after timeout')
                        playMaskContainer.style.visibility = 'hidden'
                    }
                    
                    if(playButtonContainer && playButtonContainer.style.visibility !== 'visible') {
                        loggerLandingUI.info('Force showing button UI after timeout') 
                        playButtonContainer.style.visibility = 'visible'
                    }
                }, 3000)
            }

            const start = Date.now()
            
            const tempListener = function(data){
                if(GAME_LAUNCH_REGEX.test(data.trim())){
                    const diff = Date.now()-start
                    if(diff < MIN_LINGER) {
                        setTimeout(() => {
                            onLoadComplete()
                            onGameLaunchComplete()
                        }, MIN_LINGER-diff)
                    } else {
                        onLoadComplete()
                        onGameLaunchComplete()
                    }
                }
            }

            const gameStateChange = function(data){
                data = data.trim()
                if(SERVER_JOINED_REGEX.test(data)){
                    DiscordWrapper.updateDetails(Lang.queryJS('landing.discord.joined'))
                } else if(GAME_JOINED_REGEX.test(data)){
                    DiscordWrapper.updateDetails(Lang.queryJS('landing.discord.playing'))
                }
            }

            const gameErrorListener = function(data){
                data = data.trim()
                if(data.indexOf('Could not find or load main class net.minecraft.launchwrapper.Launch') > -1){
                    loggerLaunchSuite.error('Game launch failed, LaunchWrapper was not downloaded properly.')
                    showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), Lang.queryJS('landing.dlAsync.launchWrapperNotDownloaded'))
                }
            }

            // Build Minecraft process
            proc = pb.build()
            console.log('[DEBUG] proc 할당:', !!proc)
            bindProcCloseEvent() // 반드시 여기서만!

            if(!proc) {
                throw new Error('Failed to create game process')
            }

            // Bind listeners (proc가 정의된 경우에만)
            if(proc.stdout && proc.stdout.on) {
                proc.stdout.on('data', tempListener)
            }
            if(proc.stderr && proc.stderr.on) {
                proc.stderr.on('data', gameErrorListener)
            }

            setLaunchDetails(Lang.queryJS('landing.dlAsync.doneEnjoyServer'))

            // Discord RPC
            if(distro.rawDistribution.discord != null && serv.rawServer.discord != null){
                DiscordWrapper.initRPC(distro.rawDistribution.discord, serv.rawServer.discord)
                hasRPC = true
            }
        }
    } catch(err) {
        loggerLaunchSuite.error('Error during launch', err)
        showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), err.displayable || Lang.queryJS('landing.dlAsync.seeConsoleForDetails'))
        return
    }
}


/**
 * News Loading Functions
 */

// DOM Cache
const newsContent                   = document.getElementById('newsContent')
const newsArticleTitle              = document.getElementById('newsArticleTitle')
const newsArticleDate               = document.getElementById('newsArticleDate')
const newsArticleAuthor             = document.getElementById('newsArticleAuthor')
const newsArticleComments           = document.getElementById('newsArticleComments')
const newsNavigationStatus          = document.getElementById('newsNavigationStatus')
const newsArticleContentScrollable  = document.getElementById('newsArticleContentScrollable')
const nELoadSpan                    = document.getElementById('nELoadSpan')

// News slide caches.
let newsActive = false
let newsGlideCount = 0

/**
 * Show the news UI via a slide animation.
 * 
 * @param {boolean} up True to slide up, otherwise false. 
 */
function slide_(up){
    const lCUpper = document.querySelector('#landingContainer > #upper')
    const lCLLeft = document.querySelector('#landingContainer > #lower > #left')
    const lCLCenter = document.querySelector('#landingContainer > #lower > #center')
    const lCLRight = document.querySelector('#landingContainer > #lower > #right')
    const newsBtn = document.querySelector('#landingContainer > #lower > #center #content')
    const landingContainer = document.getElementById('landingContainer')
    const newsContainer = document.querySelector('#landingContainer > #newsContainer')

    newsGlideCount++

    if(up){
        lCUpper.style.top = '-200vh'
        lCLLeft.style.top = '-200vh'
        lCLCenter.style.top = '-200vh'
        lCLRight.style.top = '-200vh'
        newsBtn.style.top = '130vh'
        newsContainer.style.top = '0px'
        //date.toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: 'numeric'})
        //landingContainer.style.background = 'rgba(29, 29, 29, 0.55)'
        landingContainer.style.background = 'rgba(0, 0, 0, 0.50)'
        setTimeout(() => {
            if(newsGlideCount === 1){
                lCLCenter.style.transition = 'none'
                newsBtn.style.transition = 'none'
            }
            newsGlideCount--
        }, 2000)
    } else {
        setTimeout(() => {
            newsGlideCount--
        }, 2000)
        landingContainer.style.background = null
        lCLCenter.style.transition = null
        newsBtn.style.transition = null
        newsContainer.style.top = '100%'
        lCUpper.style.top = '0px'
        lCLLeft.style.top = '0px'
        lCLCenter.style.top = '0px'
        lCLRight.style.top = '0px'
        newsBtn.style.top = '10px'
    }
}

// Bind news button.
document.getElementById('newsButton').onclick = () => {
    // Toggle tabbing.
    if(newsActive){
        $('#landingContainer *').removeAttr('tabindex')
        $('#newsContainer *').attr('tabindex', '-1')
    } else {
        $('#landingContainer *').attr('tabindex', '-1')
        $('#newsContainer, #newsContainer *, #lower, #lower #center *').removeAttr('tabindex')
        if(newsAlertShown){
            $('#newsButtonAlert').fadeOut(2000)
            newsAlertShown = false
            ConfigManager.setNewsCacheDismissed(true)
            ConfigManager.save()
        }
    }
    slide_(!newsActive)
    newsActive = !newsActive
}

// Array to store article meta.
let newsArr = null

// News load animation listener.
let newsLoadingListener = null

/**
 * Set the news loading animation.
 * 
 * @param {boolean} val True to set loading animation, otherwise false.
 */
function setNewsLoading(val){
    if(val){
        const nLStr = Lang.queryJS('landing.news.checking')
        let dotStr = '..'
        nELoadSpan.innerHTML = nLStr + dotStr
        newsLoadingListener = setInterval(() => {
            if(dotStr.length >= 3){
                dotStr = ''
            } else {
                dotStr += '.'
            }
            nELoadSpan.innerHTML = nLStr + dotStr
        }, 750)
    } else {
        if(newsLoadingListener != null){
            clearInterval(newsLoadingListener)
            newsLoadingListener = null
        }
    }
}

// Bind retry button.
newsErrorRetry.onclick = () => {
    $('#newsErrorFailed').fadeOut(250, () => {
        initNews()
        $('#newsErrorLoading').fadeIn(250)
    })
}

newsArticleContentScrollable.onscroll = (e) => {
    if(e.target.scrollTop > Number.parseFloat($('.newsArticleSpacerTop').css('height'))){
        newsContent.setAttribute('scrolled', '')
    } else {
        newsContent.removeAttribute('scrolled')
    }
}

/**
 * Reload the news without restarting.
 * 
 * @returns {Promise.<void>} A promise which resolves when the news
 * content has finished loading and transitioning.
 */
function reloadNews(){
    return new Promise((resolve, reject) => {
        $('#newsContent').fadeOut(250, () => {
            $('#newsErrorLoading').fadeIn(250)
            initNews().then(() => {
                resolve()
            })
        })
    })
}

let newsAlertShown = false

/**
 * Show the news alert indicating there is new news.
 */
function showNewsAlert(){
    newsAlertShown = true
    $(newsButtonAlert).fadeIn(250)
}

async function digestMessage(str) {
    const msgUint8 = new TextEncoder().encode(str)
    const hashBuffer = await crypto.subtle.digest('SHA-1', msgUint8)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const hashHex = hashArray
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    return hashHex
}

/**
 * Initialize News UI. This will load the news and prepare
 * the UI accordingly.
 * 
 * @returns {Promise.<void>} A promise which resolves when the news
 * content has finished loading and transitioning.
 */
async function initNews(){

    setNewsLoading(true)

    const news = await loadNews()

    newsArr = news?.articles || null

    if(newsArr == null){
        // News Loading Failed
        setNewsLoading(false)

        await $('#newsErrorLoading').fadeOut(250).promise()
        await $('#newsErrorFailed').fadeIn(250).promise()

    } else if(newsArr.length === 0) {
        // No News Articles
        setNewsLoading(false)

        ConfigManager.setNewsCache({
            date: null,
            content: null,
            dismissed: false
        })
        ConfigManager.save()

        await $('#newsErrorLoading').fadeOut(250).promise()
        await $('#newsErrorNone').fadeIn(250).promise()
    } else {
        // Success
        setNewsLoading(false)

        const lN = newsArr[0]
        const cached = ConfigManager.getNewsCache()
        let newHash = await digestMessage(lN.content)
        let newDate = new Date(lN.date)
        let isNew = false

        if(cached.date != null && cached.content != null){

            if(new Date(cached.date) >= newDate){

                // Compare Content
                if(cached.content !== newHash){
                    isNew = true
                    showNewsAlert()
                } else {
                    if(!cached.dismissed){
                        isNew = true
                        showNewsAlert()
                    }
                }

            } else {
                isNew = true
                showNewsAlert()
            }

        } else {
            isNew = true
            showNewsAlert()
        }

        if(isNew){
            ConfigManager.setNewsCache({
                date: newDate.getTime(),
                content: newHash,
                dismissed: false
            })
            ConfigManager.save()
        }

        const switchHandler = (forward) => {
            let cArt = parseInt(newsContent.getAttribute('article'))
            let nxtArt = forward ? (cArt >= newsArr.length-1 ? 0 : cArt + 1) : (cArt <= 0 ? cArt = newsArr.length-1 : cArt - 1)
    
            displayArticle(newsArr[nxtArt], nxtArt+1)
        }

        document.getElementById('newsNavigateRight').onclick = () => { switchHandler(true) }
        document.getElementById('newsNavigateLeft').onclick = () => { switchHandler(false) }
        await $('#newsErrorContainer').fadeOut(250).promise()
        displayArticle(newsArr[0], 1)
        await $('#newsContent').fadeIn(250).promise()
    }


}

/**
 * Add keyboard controls to the news UI. Left and right arrows toggle
 * between articles. If you are on the landing page, the up arrow will
 * open the news UI.
 */
document.addEventListener('keydown', (e) => {
    if(newsActive){
        if(e.key === 'ArrowRight' || e.key === 'ArrowLeft'){
            document.getElementById(e.key === 'ArrowRight' ? 'newsNavigateRight' : 'newsNavigateLeft').click()
        }
        // Interferes with scrolling an article using the down arrow.
        // Not sure of a straight forward solution at this point.
        // if(e.key === 'ArrowDown'){
        //     document.getElementById('newsButton').click()
        // }
    } else {
        if(getCurrentView() === VIEWS.landing){
            if(e.key === 'ArrowUp'){
                document.getElementById('newsButton').click()
            }
        }
    }
})

/**
 * Display a news article on the UI.
 * 
 * @param {Object} articleObject The article meta object.
 * @param {number} index The article index.
 */
function displayArticle(articleObject, index){
    newsArticleTitle.innerHTML = articleObject.title
    newsArticleTitle.href = articleObject.link
    newsArticleAuthor.innerHTML = 'by ' + articleObject.author
    newsArticleDate.innerHTML = articleObject.date
    newsArticleComments.innerHTML = articleObject.comments
    newsArticleComments.href = articleObject.commentsLink
    newsArticleContentScrollable.innerHTML = '<div id="newsArticleContentWrapper"><div class="newsArticleSpacerTop"></div>' + articleObject.content + '<div class="newsArticleSpacerBot"></div></div>'
    Array.from(newsArticleContentScrollable.getElementsByClassName('bbCodeSpoilerButton')).forEach(v => {
        v.onclick = () => {
            const text = v.parentElement.getElementsByClassName('bbCodeSpoilerText')[0]
            text.style.display = text.style.display === 'block' ? 'none' : 'block'
        }
    })
    newsNavigationStatus.innerHTML = Lang.query('ejs.landing.newsNavigationStatus', {currentPage: index, totalPages: newsArr.length})
    newsContent.setAttribute('article', index-1)
}

/**
 * Load news information from the RSS feed specified in the
 * distribution index.
 */
async function loadNews(){
    const distroData = await DistroAPI.getDistribution()
    if(!distroData.rawDistribution.rss || typeof distroData.rawDistribution.rss !== 'string' || !/^https?:\/\//.test(distroData.rawDistribution.rss)) {
        loggerLanding.debug('No valid RSS feed provided.')
        return null
    }
    const newsFeed = distroData.rawDistribution.rss
    const newsHost = new URL(newsFeed).origin + '/'
    const promise = new Promise((resolve, reject) => {
        
        const newsFeed = distroData.rawDistribution.rss
        const newsHost = new URL(newsFeed).origin + '/'
        $.ajax({
            url: newsFeed,
            success: (data) => {
                const items = $(data).find('item')
                const articles = []

                for(let i=0; i<items.length; i++){
                // JQuery Element
                    const el = $(items[i])

                    // Resolve date.
                    const date = new Date(el.find('pubDate').text()).toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: 'numeric'})

                    // Resolve comments.
                    let comments = el.find('slash\\:comments').text() || '0'
                    comments = comments + ' Comment' + (comments === '1' ? '' : 's')

                    // Fix relative links in content.
                    let content = el.find('content\\:encoded').text()
                    let regex = /src="(?!http:\/\/|https:\/\/)(.+?)"/g
                    let matches
                    while((matches = regex.exec(content))){
                        content = content.replace(`"${matches[1]}"`, `"${newsHost + matches[1]}"`)
                    }

                    let link   = el.find('link').text()
                    let title  = el.find('title').text()
                    let author = el.find('dc\\:creator').text()

                    // Generate article.
                    articles.push(
                        {
                            link,
                            title,
                            date,
                            author,
                            content,
                            comments,
                            commentsLink: link + '#comments'
                        }
                    )
                }
                resolve({
                    articles
                })
            },
            timeout: 2500
        }).catch(err => {
            resolve({
                articles: null
            })
        })
    })

    return await promise
}

// 페이지 로드 시 초기화
document.addEventListener('DOMContentLoaded', () => {
    // 시작 시 로딩 UI 표시
    const playButtonContainer = document.getElementById('playButtonContainer')
    const playMaskContainer = document.getElementById('playMaskContainer')
    const progressMask = document.getElementById('progress-mask')
    
    if(playButtonContainer) {
        playButtonContainer.style.visibility = 'hidden'
    }
    if(playMaskContainer) {
        playMaskContainer.style.visibility = 'visible'
    }
    if(progressMask) {
        progressMask.style.width = '0%'
    }

    // 3초 후에 로딩 완료 처리
    setTimeout(() => {
        if(playMaskContainer) {
            playMaskContainer.style.visibility = 'hidden'
        }
        if(playButtonContainer) {
            playButtonContainer.style.visibility = 'visible'
        }
        if(progressMask) {
            progressMask.style.width = '0%' 
        }
    }, 3000)
})
