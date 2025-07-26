import { Socket } from 'socket.io';
import { Server as SocketIOServer } from 'socket.io';
import { Pool } from 'mysql2/promise';
import { Player, GuessData, ReturnData } from '../types';
import { SanitizeData } from '../utils/SanitizeData';
import { PullPlayerData } from '../utils/PullPlayerData';

export async function RegisterGuess(
    socket: Socket, 
    guessData: GuessData, 
    pool: Pool, 
    allPlayers: Player[], 
    io: SocketIOServer
): Promise<void> {
    const returnData: ReturnData = {success: false};
    const requiredData = ["playerKey", "playerSecret"];

    const sanitizedData = await SanitizeData(guessData, requiredData, pool);
    if(sanitizedData.clean === false) {
        returnData.error = "SanitizeData failed when registering player's guess. " + sanitizedData.error;
        socket.emit('guess made', JSON.stringify(returnData));
        return;
    }

    if (!sanitizedData.playerKey || !sanitizedData.playerSecret) {
        returnData.error = "Missing playerKey or playerSecret after sanitization.";
        socket.emit('guess made', JSON.stringify(returnData));
        return;
    }

    const roomCode = sanitizedData.roomCode;
    const playerKey = sanitizedData.playerKey;
    const playerSecret = sanitizedData.playerSecret;
    const questionIndex = sanitizedData.questionIndex;

    // Register the guess
    if (!await pool.query(`UPDATE player SET choice= ${questionIndex} WHERE player_key= ${playerKey} AND secret = '${playerSecret}';`)) {
        returnData.error = "Couldn't registering player's guess.";
        socket.emit('guess made', JSON.stringify(returnData));
        return;
    }


    if (roomCode !== undefined) {
      // Pull the player list to send back
      const playerList = await PullPlayerData(roomCode, pool);
      if (!playerList || playerList.length == 0) {
          returnData.error = "Couldn't pull player list while registering guess.";
          socket.emit('guess made', JSON.stringify(returnData));
          return;
      }
      playerList.forEach(player => { delete player.playerSecret; });
      returnData.playerList = playerList;

      // Tell everyone about the guess just registered
      returnData.success = true;
      io.in(roomCode).emit('guess made', JSON.stringify(returnData));
    }
}