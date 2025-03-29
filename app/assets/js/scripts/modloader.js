const fs = require('fs-extra')
const { LoggerUtil } = require('helios-core')
const path = require('path')

const logger = LoggerUtil.getLogger('ModLoader')

class ModLoader {
    constructor() {
        this.ALLOWED_MODS = [
            'caramelChat-mc1.21.1-forge-1.2.0.jar',
            'journeymap-forge-1.21.1-6.0.0-beta.39.jar',
            'voicechat-forge-1.21.1-2.5.28.jar'
        ]
    }

    validateMods(instancePath) {
        const modsDir = path.join(instancePath, 'mods')
        const files = fs.readdirSync(modsDir)
        
        logger.info('Validating mods...')
        
        // 허용되지 않은 모드 확인
        for(const file of files) {
            if(!this.ALLOWED_MODS.includes(file)) {
                logger.error(`허용되지 않은 모드 발견: ${file}`)
                return false
            }
        }

        // 필수 모드가 모두 있는지 확인
        for(const requiredMod of this.ALLOWED_MODS) {
            if(!files.includes(requiredMod)) {
                logger.error(`필수 모드 누락: ${requiredMod}`)
                return false
            }
        }
        
        logger.info('모드 검증 완료')
        return true
    }
}

module.exports = ModLoader
