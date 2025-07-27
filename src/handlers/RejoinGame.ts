import { Socket } from 'socket.io';
import { Server as SocketIOServer } from 'socket.io';
import { Pool } from 'mysql2/promise';
import { Player, RejoinData, ReturnData } from '../types';
import { SanitizeData } from '../utils/SanitizeData';
import { PullRoomCode } from '../utils/PullRoomCode';
import { PullPlayerData } from '../utils/PullPlayerData';
import { PullRoomData } from '../utils/PullRoomData';

/**
 * Rejoins a game a player was previous in.
 *
 * @param {socket} socket The rejoining player's socket
 * @param {JSON} rejoinData Contains the player's key and secret (but not room code)
 * @return {void}
 */
export async function RejoinGame(
    socket: Socket, 
    rejoinData: RejoinData, 
    pool: Pool, 
    allPlayers: Player[], 
    io: SocketIOServer
): Promise<void> {
    const returnData: ReturnData = {success: false};


    // Sanitize and verify input
    const requiredData = ["playerKey", "playerSecret"];
    const sanitizedData = await SanitizeData(rejoinData, requiredData, pool);
    if(sanitizedData.clean === false) {
        returnData.error = "SanitizeData failed when rejoining game. " + sanitizedData.error;
        socket.emit('game rejoined', JSON.stringify(returnData));
        return;
    }

    const playerKey = sanitizedData.playerKey!;
    const playerSecret = sanitizedData.playerSecret!;
    returnData.playerKey = playerKey; // Tells current players which player rejoined


    // Update the player's new socket, or store all their data if they don't have an entry, then connect the socket to the room
    const playerEntry = allPlayers.find(player => { return player.playerKey === playerKey && player.playerSecret === playerSecret});
    if(playerEntry) {
        playerEntry.socket = socket.id;
    } else {
        allPlayers.push({"socket":socket.id, "playerKey":playerKey, "playerSecret": playerSecret});
    }


    // Pull the player's room code
    const roomCode = await PullRoomCode(playerKey, playerSecret, pool);
    if(!roomCode) {
        returnData.error = "No roomcode results when looking up player key/secret pair for rejoining game.";
        socket.emit('game rejoined', JSON.stringify(returnData));
        return;
    }
    socket.join(roomCode);


    // Set the player as active, in case they were set as inactive
    if(!await pool.query(`UPDATE player SET active = TRUE WHERE player_key = ${playerKey};`)) {
        returnData.error = "Couldn't update to Active when rejoining room.";
        socket.emit('game rejoined', JSON.stringify(returnData));
        return;
    }


    // Pull info about all players in the room
    const playerList = await PullPlayerData(roomCode, pool);
    if (!playerList || playerList.length == 0) {
        returnData.error = "Couldn't pull player list while rejoining room.";
        socket.emit('game rejoined', JSON.stringify(returnData));
        return;
    }
    playerList.forEach(player => { delete player.playerSecret; });
    returnData.playerList = playerList;


    // Pull room data
    const roomData = await PullRoomData(roomCode, pool);
    if (!roomData) {
        if(roomData === false) { returnData.error = "Error searching for room to rejoin."; }
        if(roomData === null)  { returnData.error = "Tried to rejoin a non-existant room."; }
        socket.emit('game rejoined', JSON.stringify(returnData));
        return;
    }


    returnData.roomData = roomData;
    returnData.success = true;

    // Tell everyone else a player (re)joined
    socket.to(roomCode).emit('player joined',  JSON.stringify(returnData));

    // Tell player who rejoined
    socket.emit('game rejoined', JSON.stringify(returnData));    
}