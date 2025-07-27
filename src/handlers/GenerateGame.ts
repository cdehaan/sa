import { Socket } from 'socket.io';
import { Server as SocketIOServer } from 'socket.io';
import { Pool } from 'mysql2/promise';
import { Player, RequestData, ReturnData } from '../types';
import { SanitizeData } from '../utils/SanitizeData';
import { PullPlayerData } from '../utils/PullPlayerData';

export async function GenerateGame(
    socket: Socket, 
    requestData: RequestData, 
    pool: Pool, 
    allPlayers: Player[], 
    io: SocketIOServer
): Promise<void> {
    const returnData: ReturnData = {success: false};
    const requiredData = ["playerName"];

    const sanitizedData = await SanitizeData(requestData, requiredData, pool);
    if(sanitizedData.clean === false) {
        returnData.error = "SanitizeData failed when creating room. " + sanitizedData.error;
        socket.emit('game created', JSON.stringify(returnData));
        return;
    }
    if (!sanitizedData.playerName) {
        returnData.error = "Missing playerName after sanitization.";
        socket.emit('game created', JSON.stringify(returnData));
        return;
    }
    const playerName = sanitizedData.playerName.substring(0,12);
    const playerSecret = Math.random().toString(36).slice(2).replace(/[^0-9a-z]/gi, '');
    returnData.playerSecret = playerSecret;


    // Generate a random 5-letter string for the room code. If this code already exists, make another.
    let newRoomCode: string;
    while (true) {
        newRoomCode = "";
        for (let i=0; i < 5; i++) {newRoomCode += String.fromCharCode(Math.floor((Math.random() * 26) + 65));}
        const roomExistsResult = await pool.query(`SELECT count(*) AS roomCount FROM room WHERE room_code='${newRoomCode}';`);
        if (!roomExistsResult) {
            returnData.error = "Couldn't check for existing room code.";
            socket.emit('game created', JSON.stringify(returnData));
            return;
        }
        if ((roomExistsResult[0] as any)[0].roomCount === 0) { break; }
    }


    // Create the room in the database then put the room creator into the room
    await pool.query(`INSERT INTO room (room_code, current_player) VALUES ('${newRoomCode}', 1);`);
    const insertPlayerResult = await pool.query(`INSERT INTO player (room_code, player_index, player_name, secret) VALUES ('${newRoomCode}', 1, '${playerName}', '${playerSecret}');`);
    const playerKey = (insertPlayerResult[0] as any).insertId;
    returnData.playerKey = playerKey;


    // Put the player's socket, key, and secret into the array of sockets/keys then join the room socket
    allPlayers.push({"socket":socket.id, "playerKey":playerKey, "playerSecret": playerSecret});
    socket.join(newRoomCode);


    // Create the room variable, to be returned
    returnData.roomData = {
        roomCode: newRoomCode, 
        roomGameState: 0, 
        roomCurrentPlayer: 1,
        roomCorrectAnswer: 0,
        roomCardKey: -1,
        roomQuestionRevealed: 0,
        last_action: ""
    };


    // Pull the player list (should be just 1 player at this point), hide the secret for consistency
    const playerList = await PullPlayerData(newRoomCode, pool);
    if (!playerList || playerList.length != 1) {
        returnData.error = "Couldn't pull player list while generating room.";
        socket.emit('game created', JSON.stringify(returnData));
        return;
    }
    returnData.playerList = playerList;

    returnData.success = true;
    socket.emit('game created', JSON.stringify(returnData));
}