const {ipcRenderer}  = require('electron')
const fs             = require('fs-extra')
const os             = require('os')
const path           = require('path')
const net            = require('net')

const ConfigManager  = require('./configmanager')
const { DistroAPI }  = require('./distromanager')
const LangLoader     = require('./langloader')
const { LoggerUtil } = require('helios-core')
// eslint-disable-next-line no-unused-vars
const { HeliosDistribution } = require('helios-core/common')

const logger = LoggerUtil.getLogger('Preloader')

logger.info('Loading..')

// Load ConfigManager
ConfigManager.load()

// Yuck!
// TODO Fix this
DistroAPI['commonDir'] = ConfigManager.getCommonDirectory()
DistroAPI['instanceDir'] = ConfigManager.getInstanceDirectory()

// Load Strings
LangLoader.setupLanguage()

// Server Status Check Function
function checkServerStatus(address = 'godlightdev.kro.kr', port = 25565) {
    return new Promise((resolve) => {
        const socket = net.connect({
            host: address,
            port: port,
            timeout: 3000
        }, () => {
            const pingBuf = Buffer.from([0xFE, 0x01])
            socket.write(pingBuf)
        })

        socket.on('data', () => {
            socket.end()
            resolve(true)
        })

        socket.on('error', () => {
            socket.destroy()
            resolve(false)
        })

        socket.on('timeout', () => {
            socket.destroy()
            resolve(false)
        })
    })
}

// Receive check-server-status request from renderer
ipcRenderer.on('check-server-status', async () => {
    const isOnline = await checkServerStatus()
    // Send the result back to renderer
    ipcRenderer.sendToHost('server-status-update', isOnline)
})

/**
 * 
 * @param {HeliosDistribution} data 
 */
function onDistroLoad(data){
    if(data != null){
        
        // Resolve the selected server if its value has yet to be set.
        if(ConfigManager.getSelectedServer() == null || data.getServerById(ConfigManager.getSelectedServer()) == null){
            logger.info('Determining default selected server..')
            ConfigManager.setSelectedServer(data.getMainServer().rawServer.id)
            ConfigManager.save()
        }
    }
    ipcRenderer.send('distributionIndexDone', data != null)
}

// Ensure Distribution is downloaded and cached.
DistroAPI.getDistribution()
    .then(heliosDistro => {
        logger.info('Loaded distribution index.')

        onDistroLoad(heliosDistro)
    })
    .catch(err => {
        logger.info('Failed to load an older version of the distribution index.')
        logger.info('Application cannot run.')
        logger.error(err)

        onDistroLoad(null)
    })

// Clean up temp dir incase previous launches ended unexpectedly. 
fs.remove(path.join(os.tmpdir(), ConfigManager.getTempNativeFolder()), (err) => {
    if(err){
        logger.warn('Error while cleaning natives directory', err)
    } else {
        logger.info('Cleaned natives directory.')
    }
})