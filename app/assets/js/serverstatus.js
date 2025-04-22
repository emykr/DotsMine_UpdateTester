const net = require('net')

/**
 * Retrieves the status of a minecraft server.
 * 
 * @param {string} address The server address.
 * @param {number} port Optional. The port of the server. Defaults to 25565.
 * @returns {Promise.<Object>} A promise which resolves to an object containing
 * status information.
 */
exports.getStatus = function(address, port = 25565){
    if(port == null || port == ''){
        port = 25565
    }
    if(typeof port === 'string'){
        port = parseInt(port)
    }

    return new Promise((resolve, reject) => {
        const socket = net.connect(port, address, () => {
            let buff = Buffer.from([0xFE, 0x01])
            socket.write(buff)
        })

        socket.setTimeout(2500, () => {
            socket.end()
            resolve({
                online: false
            })
        })

        socket.on('data', (data) => {
            if(data != null && data != ''){
                let server_info = data.toString().split('\x00\x00\x00')
                const NUM_FIELDS = 6
                if(server_info != null && server_info.length >= NUM_FIELDS){
                    // 플레이어 수 파싱이 실패해도 online: true로 처리
                    let onlinePlayers = server_info[4] ? server_info[4].replace(/\u0000/g, '') : ''
                    let maxPlayers = server_info[5] ? server_info[5].replace(/\u0000/g,'') : ''
                    resolve({
                        online: true,
                        version: server_info[2].replace(/\u0000/g, ''),
                        motd: server_info[3].replace(/\u0000/g, ''),
                        onlinePlayers,
                        maxPlayers
                    })
                } else {
                    // 데이터가 왔으면 일단 online: true로 처리
                    resolve({
                        online: true
                    })
                }
            } else {
                resolve({
                    online: false
                })
            }
            socket.end()
        })

        socket.on('error', (err) => {
            socket.destroy()
            resolve({
                online: false
            })
        })
    })
}

let lastStatus = false // 마지막 서버 상태 저장
let checkInterval = null // 상태 체크 인터벌 저장

exports.updateServerStatus = function(address, port = 25565) {
    // 이전 인터벌이 있다면 제거
    if(checkInterval) {
        clearInterval(checkInterval)
    }

    // 즉시 한 번 체크
    checkServerStatus(address, port)
    
    // 30초마다 상태 체크 (설정 가능)
    checkInterval = setInterval(() => checkServerStatus(address, port), 30000)
}

function checkServerStatus(address, port) {
    exports.getStatus(address, port).then(status => {
        const serverStatusImg = document.getElementById('serverStatus')
        if(serverStatusImg) {
            if (status.online) {
                serverStatusImg.src = 'assets/images/duckarmri/server_on.png'
            } else {
                serverStatusImg.src = 'assets/images/duckarmri/server_off.png'
            }
            lastStatus = status.online
        }
    }).catch(() => {
        const serverStatusImg = document.getElementById('serverStatus')
        if(serverStatusImg) {
            serverStatusImg.src = 'assets/images/duckarmri/server_off.png'
            lastStatus = false
        }
    })
}