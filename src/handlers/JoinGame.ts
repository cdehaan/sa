import { Socket } from 'socket.io';
import { Server as SocketIOServer } from 'socket.io';
import { Pool } from 'mysql2/promise';
import { Player, JoinData, ReturnData, RejoinData } from '../types';
import { SanitizeData } from '../utils/SanitizeData';
import { FindExistingPlayer } from '../utils/FindExistingPlayer';
import { PullRoomData } from '../utils/PullRoomData';
import { PullPlayerData } from '../utils/PullPlayerData';
import { RejoinGame } from './RejoinGame';

export async function JoinGame(
    socket: Socket, 
    joinData: JoinData, 
    pool: Pool, 
    allPlayers: Player[], 
    io: SocketIOServer
): Promise<void> {
    const returnData: ReturnData = {success: false};
    const requiredData = ["playerName", "roomCode"];

    const sanitizedData = await SanitizeData(joinData, requiredData, pool);
    if(sanitizedData.clean === false) {
        returnData.error = "SanitizeData failed when creating room. " + sanitizedData.error;
        socket.emit('game joined', JSON.stringify(returnData));
        return;
    }

    if (!sanitizedData.playerName || !sanitizedData.roomCode) {
        returnData.error = "Missing playerName or roomCode after sanitization.";
        socket.emit('game joined', JSON.stringify(returnData));
        return;
    }

    // Check for existing players, and pipe them to "rejoin" instead of "join"
    if(sanitizedData.playerKey && sanitizedData.playerSecret) {
        const existingPlayer = await FindExistingPlayer(sanitizedData.playerKey, sanitizedData.playerSecret, pool);
        if (existingPlayer && existingPlayer[0].length > 0) {
            const rejoinData: RejoinData = {
                playerKey: sanitizedData.playerKey,
                playerSecret: sanitizedData.playerSecret
            };
            RejoinGame(socket, rejoinData, pool, allPlayers, io);
            return;
        }
    }

    const playerName = sanitizedData.playerName.substring(0,12);
    const roomCode = sanitizedData.roomCode.toUpperCase();
    socket.join(roomCode);


    // Pull info about the room, including game state (+ card and questions if they exist)
    const roomData = await PullRoomData(roomCode, pool);
    if (!roomData) {
        if(roomData === false) { returnData.error = "Error searching for room to join."; }
        if(roomData === null)  { returnData.error = "Tried to join a non-existant room."; }
        socket.emit('game joined', JSON.stringify(returnData));
        return;
    }


    // Find the max index (i.e. order of play) for all players in the room (empty room = 0)
    let maxIndexResult = await pool.query(`SELECT MAX(player_index) AS MaxIndex FROM player WHERE room_code='${roomCode}';`);
    if (!maxIndexResult) {
        returnData.error = "Couldn't pull current max index joining room.";
        socket.emit('game joined', JSON.stringify(returnData));
        return;
    }
    const maxIndex = parseInt((maxIndexResult[0] as any)[0].MaxIndex) || 0;


    // If the room index (i.e. current player) is the first player, just set the new player index to one plus the max index of all other players
    let joiningPlayerIndex: number;
    if (roomData.roomCurrentPlayer == 1) {
        joiningPlayerIndex = maxIndex + 1;
    }

    // If the current player isn't the first player, push up all upcoming player indexes, then slot the new player into the current slot, then progress room's index
    // If the room index was 10, make everyone 10 or above one larger, make the new player 10, and set the room to 11
    // Why? This means the new player will be the last player in line to be the actor
    else {
        if (!await pool.query(`UPDATE player SET player_index = player_index+1 WHERE player_index >= ${roomData.roomCurrentPlayer} AND room_code='${roomCode}';`)) {
            returnData.error = "Couldn't update other player indexes while joining room.";
            socket.emit('game joined', JSON.stringify(returnData));
            return;
        }
        if(!await pool.query(`UPDATE room SET current_player = current_player+1 WHERE room_code = '${roomCode}';`)) {
            returnData.error = "Couldn't update room index while joining room.";
            socket.emit('game joined', JSON.stringify(returnData));
            return;
        }
        joiningPlayerIndex = roomData.roomCurrentPlayer;
        roomData.roomCurrentPlayer++;
    }


    // Insert the player into the database, with a new secret
    const playerSecret = Math.random().toString(36).slice(2);
    const insertPlayerResult = await pool.query(`INSERT INTO player (room_code, player_index, player_name, secret) VALUES ('${roomCode}', ${joiningPlayerIndex}, '${playerName}', '${playerSecret}');`);
    if (!insertPlayerResult) {
        returnData.error = "Couldn't insert player into room while joining room."; socket.emit('game joined', JSON.stringify(returnData));
        return;
    }
    const playerKey = (insertPlayerResult[0] as any).insertId;
    returnData.playerKey = playerKey;  // So everyone know which player just joined, and new player knows their key

    console.log(playerName + " joined room " + roomCode);

    // Save the player's socket id, key, and secret
    allPlayers.push({"socket":socket.id, "playerKey":playerKey, "playerSecret": playerSecret});

    // Pull info about all players in the room
    const playerList = await PullPlayerData(roomCode, pool);
    if (!playerList || playerList.length == 0) { returnData.error = "Couldn't pull player list while joining room."; socket.emit('game joined', JSON.stringify(returnData)); return; }
    playerList.forEach(player => { delete player.playerSecret; });
    returnData.playerList = playerList;

    returnData.roomData = roomData;


    // Tell everyone else a player joined
    returnData.success = true;
    socket.broadcast.to(roomCode).emit('player joined',  JSON.stringify(returnData));


    // Tell player who joined (include their secret)
    returnData.playerSecret = playerSecret;
    socket.emit('game joined', JSON.stringify(returnData));
}