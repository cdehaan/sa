import { Socket } from 'socket.io';
import { Server as SocketIOServer } from 'socket.io';
import { Pool } from 'mysql2/promise';
import { Player, LeaveData, ReturnData } from '../types';
import { SanitizeData } from '../utils/SanitizeData';
import { PullRoomCode } from '../utils/PullRoomCode';
import { PullPlayerData } from '../utils/PullPlayerData';

export async function LeaveGame(
    socket: Socket, 
    leaveData: LeaveData, 
    pool: Pool, 
    allPlayers: Player[], 
    io: SocketIOServer
): Promise<void> {
    const returnData: ReturnData = {success: false};

    // Sanitize the leave data
    const requiredData = ["playerKey", "playerSecret"];
    const sanitizedData = await SanitizeData(leaveData, requiredData, pool);
    if(sanitizedData.clean === false) {
        returnData.error = "SanitizeData failed when leaving game. " + sanitizedData.error;
        socket.emit('game left', JSON.stringify(returnData));
        return;
    }

    if (!sanitizedData.playerKey || !sanitizedData.playerSecret) {
        returnData.error = "Missing playerKey or playerSecret after sanitization.";
        socket.emit('game left', JSON.stringify(returnData));
        return;
    }

    const playerKey = sanitizedData.playerKey;
    const playerSecret = sanitizedData.playerSecret;
    returnData.playerKey = playerKey; // So everyone knows who left

    const roomCode = await PullRoomCode(playerKey, playerSecret, pool);
    if(!roomCode) {
        returnData.error = "Couldn't find player room as they left.";
        socket.emit('game left', JSON.stringify(returnData));
        return;
    }

    // Delete the player
    if (!await pool.query(`DELETE FROM player WHERE player_key = ${playerKey} AND secret = '${playerSecret}';`)) {
        returnData.error = "Couldn't delete player as they left.";
        socket.emit('game left', JSON.stringify(returnData));
        return;
    }


    // Pull fresh data and send to everyone else in the room
    const playerList = await PullPlayerData(roomCode, pool);
    if (!playerList || playerList.length == 0) {
        returnData.error = "Couldn't pull player list while reconnecting player.";
        socket.emit('game left', JSON.stringify(returnData));
        return;
    }
    playerList.forEach(player => { delete player.playerSecret; });
    returnData.playerList = playerList;


    // Tell the departing player they can leave
    returnData.success = true;
    socket.emit('game left', JSON.stringify(returnData));

    // Tell everyone else about the player that left
    socket.to(roomCode).emit('player left', JSON.stringify(returnData));
}