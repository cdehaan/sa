import { Socket } from 'socket.io';
import { Server as SocketIOServer } from 'socket.io';
import { Pool } from 'mysql2/promise';
import { Player, ReturnData } from '../types';
import { PullPlayerData } from '../utils/PullPlayerData';

export async function RemovePlayer(
    socket: Socket, 
    pool: Pool, 
    allPlayers: Player[], 
    io: SocketIOServer
): Promise<void> {
    const returnData: ReturnData = {success: false};


    // Find the player based on the socket that closed
    const previousPlayer = allPlayers.find(player => { return player.socket === socket.id });
    if(previousPlayer === undefined) { return; } // A player not in our list is leaving, likely they never joined a game. No need to throw an error, can ignore safely.

    const playerKey = previousPlayer.playerKey;
    if (!playerKey) { return; } // A player without a key is leaving, likely they never joined a game. No need to throw an error, can ignore safely.
    returnData.playerKey = playerKey;


    // Set the player as inactive
    if (!await pool.query(`UPDATE player SET active = FALSE WHERE player_key= ${playerKey};`)) {
        returnData.error = "Couldn't set a player as inactive as they left.";
        socket.emit('player disconnected', JSON.stringify(returnData));
        return;
    }


    // Find what room the player was in
    const [playerResult] = await pool.query(`SELECT room_code as roomCode FROM player WHERE player_key = ${playerKey};`);
    if (!playerResult) {
        returnData.error = "Couldn't check room code key as someone left."; socket.emit('player disconnected', JSON.stringify(returnData));
        return;
    }
    if ((playerResult as any).length == 0) { return; } // A player not in a room is leaving, can ignore safely.
    const roomCode = (playerResult as any)[0].roomCode;
    console.log(`Player key #${playerKey} is leaving room ${roomCode}`);


    // Pull the player list to send back
    const playerList = await PullPlayerData(roomCode, pool);
    if (!playerList || playerList.length == 0) {
        returnData.error = "Couldn't pull player list after a player left."; socket.emit('player disconnected', JSON.stringify(returnData));
        return;
    }
    playerList.forEach(player => { delete player.playerSecret; });
    returnData.playerList = playerList;


    // Tell everyone else in the room that the player left
    returnData.success = true;
    socket.to(roomCode).emit('player disconnected',  JSON.stringify(returnData));
}