let roomData = {
    roomCode: null,
    roomGameState: null, // -1 no room (loading screen), 0 waiting room, 1 playing, 2 answer shown
    roomCurrentPlayer: null,
    roomCard: {},
    roomCorrectAnswer: null,
    roomQuestionRevealed: false
};

const myPlayerData = {
    playerKey:      null,
    playerSecret:   null,
    playerIndex:    null,
    playerName:     null,
    playerChoice:   null,
    playerScore:    0
};

const sessionData = {
    animating: true,
    connectionEvents: [],  // Functions to run when a connection is made or re-established
    badgeRemovals: [],     // A badge is set for removal, but this can be stopped if the player reconnects quickly
    rowsPerColumn: 6,      // This is a UI choice for the waiting room. This many player's badges can be stacked before another column is needed, should be able to put into CSS
    animationSpeed: 1      // Another UI choice, but affects settimeout delays, so hard to stick totally into CSS
}

let playerList = [];
let socket;

const languages = [
    {name: "english",  text: "English", flag: "🇬🇧"},
    {name: "japanese", text: "日本語", flag: "🇯🇵"},
    {name: "korean",   text: "한국어", flag: "🇰🇷"},
]

window.onload = function() {
    // Mobile browser vh is problematic, so we make truevh, and keep it updated
    CalculateTrueVh();
    window.onresize = CalculateTrueVh;


    // Load and validate cookie and query string data
    // Query string takes priority for roomcode, but key/secret pair in cookie takes priority over roomcode
    myPlayerData.playerKey = parseInt(getCookie("playerKey")) || null;
    myPlayerData.playerSecret = getCookie("playerSecret");
    roomData.roomCode = getCookie("roomCode");
    roomData.roomCode = new URLSearchParams(window.location.search).get('room') || roomData.roomCode;
    if(/^[a-zA-Z]{5}$/.test(roomData.roomCode) === false) { roomData.roomCode = null; }
    if(/^[a-zA-Z0-9]*$/.test(myPlayerData.playerSecret) === false) { myPlayerData.playerSecret = null; }


    // Listen for return of players who left (e.g. turned off the screen for a bit) and verify their connection
    AddVisibilityEventListener();


    GenerateCommonUI();
    ConnectSocket();


    // If the player was playing a game, rejoin it. Otherwise, show the loading screen
    if(myPlayerData.playerKey && myPlayerData.playerSecret) {
        RejoinGame();
    } else {
        GenerateLoadingScreen();
    }
};

//#region UI
function GenerateCommonUI() {
    const mainWrapper = document.getElementById("MainWrapper");
    mainWrapper.addEventListener("click", RemoveLeaveRoom);

    const confettiCanvas = document.createElement("canvas");
    confettiCanvas.id = "confettiCanvas";
    confettiCanvas.classList.add("confettiCanvas");
    mainWrapper.appendChild(confettiCanvas);
    confetti.create(confettiCanvas, { resize: true, useWorker: true });

    const offlineCover = document.createElement("div");
    offlineCover.classList.add("offlineCover");
    mainWrapper.append(offlineCover);

    const offlineHeader = document.createElement("div");
    offlineHeader.classList.add("offlineHeader");
    offlineHeader.innerHTML = "Game disconnected";
    offlineCover.append(offlineHeader);

    const offlineActions = document.createElement("div");
    offlineActions.classList.add("offlineActions");
    offlineCover.append(offlineActions);

    const offlineWait = document.createElement("div");
    offlineWait.innerHTML = "Wait or";
    offlineActions.append(offlineWait);

    const offlineReload = document.createElement("div");
    offlineReload.classList.add("offlineButton");
    offlineReload.innerHTML = "Reload";
    offlineReload.onclick = () => { location.reload(); }
    offlineActions.append(offlineReload);

    const headerDiv = document.createElement("div");
    headerDiv.id = "headerDiv";
    headerDiv.classList.add("headerDiv");
    const headerTextDiv = document.createElement("div");
    headerTextDiv.id = "headerTextDiv";
    headerTextDiv.classList.add("headerTextDiv");
    headerTextDiv.classList.add("headerLoading");
    headerTextDiv.innerHTML = "Simply Anything";
    headerTextDiv.onclick = () => { headerTextDiv.classList.toggle("headerTextShadow"); }
    headerDiv.appendChild(headerTextDiv);
    mainWrapper.appendChild(headerDiv);

    const footerDiv = document.createElement("div");
    footerDiv.id = "footerDiv";
    footerDiv.classList.add("footerDiv");
    footerDiv.style.display = "none";
    mainWrapper.appendChild(footerDiv);

    const footerElements = [
        {name: "Score",    icon: "⭐", text: "0"},
        {name: "Room",     icon: "🚪", text: "",        onclick: ToggleLeaveRoom},
        {name: "Player",   icon: "👤", text: ""},
        {name: "Qr",       icon: "▞",  text: "Invite",  onclick: ShowQR},
        {name: "Language", icon: "🇬🇧", text: "English", onclick: ShowLanguage}
    ];

    footerElements.forEach(element => {
        const footerWrapper = document.createElement("div");
        footerWrapper.id = `footer${element.name}Wrapper`;
        footerWrapper.classList.add("footerWrapper");
        if(element.onclick) { footerWrapper.onclick = element.onclick; }
        const footerIcon = document.createElement("span");
        footerIcon.innerHTML = element.icon;
        footerIcon.id = `footer${element.name}Icon`;
        footerIcon.classList.add("footerIcon");
        footerWrapper.append(footerIcon);
        const footerText = document.createElement("span");
        footerText.id = `footer${element.name}Text`;
        footerText.innerHTML = element.text;
        footerWrapper.append(footerText);
        footerDiv.append(footerWrapper);
    });

    const qrDivWrapper = document.createElement("div");
    qrDivWrapper.id = "qrDivWrapper";
    qrDivWrapper.classList.add("qrDivWrapper");
    qrDivWrapper.style.display = "none";
    qrDivWrapper.style.opacity = "0";
    mainWrapper.append(qrDivWrapper);

    const qrClose = document.createElement("div");
    qrClose.classList.add("qrClose");
    qrClose.classList.add("glassCard");
    qrClose.innerHTML = "✘";
    qrClose.addEventListener("click", () => {
        qrDivWrapper.style.display = "none";
        qrDivWrapper.style.opacity = "0";
    })
    qrDivWrapper.append(qrClose);

    const qrHeader = document.createElement("div");
    qrHeader.innerHTML = "Scan to join!";
    qrDivWrapper.append(qrHeader);

    const qrCodeDiv = document.createElement("div");
    qrCodeDiv.id = "qrCodeDiv";
    qrCodeDiv.classList.add("qrCodeDiv");
    qrDivWrapper.append(qrCodeDiv);

    const qrFooter = document.createElement("div");
    qrFooter.id = "qrFooter";
    qrFooter.classList.add("qrFooter");
    qrDivWrapper.append(qrFooter);
    ShrinkText(qrFooter);
}

// Loading screen region
{
function GenerateLoadingScreen() {
    DeconstructFirstScreen();
    document.getElementById("footerDiv").style.display = "none";
    const mainWrapper = document.getElementById("MainWrapper");

    if(roomData.roomCode === null) {
        setTimeout(function(){
            const newGameDiv = document.createElement("div");
            newGameDiv.id = "newGameDiv";
            newGameDiv.classList.add("glassCard", "firstScreenGlass", "newGameDiv", "newGameExpandAnimation", "rotate45");
            mainWrapper.appendChild(newGameDiv);
    
                const newGameTextDiv = document.createElement("div");
                newGameTextDiv.classList.add("loadingScreenText");
                newGameTextDiv.innerHTML = "New Game";
                newGameDiv.appendChild(newGameTextDiv);
    
                const newGameNameTextbox = document.createElement("input");
                newGameNameTextbox.id = "newGameNameTextbox";
                newGameNameTextbox.setAttribute("type", "text");
                newGameNameTextbox.setAttribute("autocomplete", "off");
                newGameNameTextbox.setAttribute("maxlength", "12");
                newGameNameTextbox.setAttribute("placeholder", "Your Name");
                newGameNameTextbox.classList.add("loadingScreenInput");
                newGameNameTextbox.onfocus = function() { newGameDiv.classList.remove("rotate45"); };
                newGameNameTextbox.onblur  = function() { newGameDiv.classList.add("rotate45"); };
                newGameDiv.appendChild(newGameNameTextbox);
    
                const newGameButton = document.createElement("button");
                newGameButton.classList.add("loadingScreenButton");
                newGameButton.textContent = "Start!";
                newGameButton.onfocus = function() { newGameDiv.classList.remove("rotate45"); };
                newGameButton.onblur  = function() { newGameDiv.classList.add("rotate45"); };
                newGameButton.onclick = function() { NewGame(); };
                newGameDiv.appendChild(newGameButton);
    
    
            const newGameCircleDiv = document.createElement("div");
            newGameCircleDiv.id = "newGameCircleDiv";
            newGameCircleDiv.classList.add("orangeCircle");
            newGameCircleDiv.classList.add("circleExpandAnimation");
            mainWrapper.appendChild(newGameCircleDiv);
    
        }, 1000*sessionData.animationSpeed);
    }

    setTimeout(function(){
        const joinGameDiv = document.createElement("div");
        joinGameDiv.id = "joinGameDiv";
        joinGameDiv.classList.add("glassCard");
        joinGameDiv.classList.add("firstScreenGlass");
        joinGameDiv.classList.add("rotateM85");
        joinGameDiv.classList.add("joinGameDiv");
        joinGameDiv.classList.add("joinGameExpandAnimation");
        mainWrapper.appendChild(joinGameDiv);

            const joinGameTextDiv = document.createElement("div");
            joinGameTextDiv.classList.add("loadingScreenText");
            joinGameTextDiv.innerHTML = "Join Game";
            joinGameDiv.appendChild(joinGameTextDiv);

            const joinGameNameTextbox = document.createElement("input");
            joinGameNameTextbox.id = "joinGameNameTextbox";
            joinGameNameTextbox.setAttribute("type", "text");
            joinGameNameTextbox.setAttribute("maxlength", "12");
            joinGameNameTextbox.setAttribute("autocomplete", "off");
            joinGameNameTextbox.setAttribute("placeholder", "Your Name");
            joinGameNameTextbox.classList.add("loadingScreenInput");
            joinGameNameTextbox.onfocus = function() { joinGameDiv.classList.remove("rotateM85"); };
            joinGameNameTextbox.onblur  = function()  { joinGameDiv.classList.add("rotateM85"); };
            joinGameDiv.appendChild(joinGameNameTextbox);

            const joinGameRoomcodeTextbox = document.createElement("input");
            joinGameRoomcodeTextbox.id = "joinGameRoomcodeTextbox";
            joinGameRoomcodeTextbox.setAttribute("type", "text");
            joinGameRoomcodeTextbox.setAttribute("autocomplete", "off");
            joinGameRoomcodeTextbox.setAttribute("placeholder", "Room Code");
            if (roomData.roomCode != null ) { joinGameRoomcodeTextbox.value = roomData.roomCode; }
            joinGameRoomcodeTextbox.classList.add("loadingScreenInput");
            joinGameRoomcodeTextbox.onfocus = function() { joinGameDiv.classList.remove("rotateM85"); };
            joinGameRoomcodeTextbox.onblur  = function() { joinGameDiv.classList.add("rotateM85"); };
            joinGameDiv.appendChild(joinGameRoomcodeTextbox);

            const joinGameButton = document.createElement("button");
            joinGameButton.classList.add("loadingScreenButton");
            joinGameButton.textContent = "Join!";
            joinGameButton.onfocus = function() { joinGameDiv.classList.remove("rotateM85"); };
            joinGameButton.onblur  = function() { joinGameDiv.classList.add("rotateM85"); };
            joinGameButton.onclick = function() { JoinGame(); };
            joinGameDiv.appendChild(joinGameButton);

        const joinGameCircleDiv = document.createElement("div");
        joinGameCircleDiv.id = "joinGameCircleDiv";
        joinGameCircleDiv.classList.add("blueCircle");
        joinGameCircleDiv.classList.add("circleExpandAnimation");
        mainWrapper.appendChild(joinGameCircleDiv);
    }, 1200*sessionData.animationSpeed);

    setTimeout(function() {sessionData.animating = false;}, 1500);
}

function DeconstructFirstScreen() {
    sessionData.animating = true;

    const newGameDiv = document.getElementById("newGameDiv");
    if(newGameDiv) {
        newGameDiv.classList.remove("newGameExpandAnimation");
        newGameDiv.classList.add("newGameShrinkAnimation");    
        setTimeout(function(){ newGameDiv.remove(); }, 500);
        const newGameCircleDiv = document.getElementById("newGameCircleDiv");
        newGameCircleDiv.classList.remove("circleExpandAnimation");
        newGameCircleDiv.classList.add("circleShrinkAnimation");
        setTimeout(function(){ newGameCircleDiv.remove(); }, 500);    
    }

    const joinGameDiv = document.getElementById("joinGameDiv");
    if(joinGameDiv) {
        joinGameDiv.classList.remove("joinGameExpandAnimation");
        joinGameDiv.classList.add("joinGameShrinkAnimation");    
        setTimeout(function(){ joinGameDiv.remove(); }, 500);
        const joinGameCircleDiv = document.getElementById("joinGameCircleDiv");
        joinGameCircleDiv.classList.remove("circleExpandAnimation");
        joinGameCircleDiv.classList.add("circleShrinkAnimation");
        setTimeout(function(){ joinGameCircleDiv.remove(); }, 500);    
    }

    const rejoinGameDiv = document.getElementById("rejoinGameDiv");
    if (rejoinGameDiv) {
        rejoinGameDiv.classList.remove("rejoinGameExpandAnimation");
        rejoinGameDiv.classList.add("rejoinGameShrinkAnimation");
        const rejoinGameCircleDiv = document.getElementById("rejoinGameCircleDiv");
        rejoinGameCircleDiv.classList.remove("circleExpandAnimation");
        rejoinGameCircleDiv.classList.add("circleShrinkAnimation");
        setTimeout(function(){ rejoinGameDiv.remove(); rejoinGameCircleDiv.remove(); }, 500);
    }
    document.getElementById("footerDiv").style.display = "";
    setTimeout(function() {sessionData.animating = false;}, 500);
}
} // Loading screen region


// Waiting screen region
{
function GeneratelobbyScreen() {
    sessionData.animating = true;
    document.getElementById("footerDiv").style.display = "";
    const mainWrapper = document.getElementById("MainWrapper");

    const lobbyScreenWrapper = document.createElement("div");
    lobbyScreenWrapper.id = "lobbyScreenWrapper";
    lobbyScreenWrapper.classList.add("lobbyScreenWrapper");
    mainWrapper.appendChild(lobbyScreenWrapper);

    const lobbyScreenHeader = document.createElement("div");
    lobbyScreenHeader.classList.add("lobbyScreenHeader", "lobbyScreenHeaderShrunk");
    lobbyScreenHeader.innerHTML = "Waiting for players<br/>Room code: " + roomData.roomCode;
    lobbyScreenWrapper.appendChild(lobbyScreenHeader);

    const badgeWrapper = document.createElement("div");
    badgeWrapper.classList.add("badgeWrapper");
    lobbyScreenWrapper.appendChild(badgeWrapper);

    const activePlayerList = playerList.filter(player => player.active == "1");

    const myBadge = GeneratelobbyScreenBadge(myPlayerData.playerKey);
    const myActiveIndex = activePlayerList.findIndex(player => player.playerKey === myPlayerData.playerKey);
    myBadge.style.top = "50vh";
    myBadge.style.left = "50%";
    myBadge.style.alignItems = "center";
    badgeWrapper.appendChild(myBadge);
    myBadge.style.fontSize = "";
    setTimeout(function() { myBadge.style.opacity = "1";    myBadge.style.height = "20vh";    myBadge.style.top = "40vh"; myBadge.style.width = "80%"; myBadge.style.left = "10%"; }, 100);
    setTimeout(function() { lobbyScreenHeader.classList.remove("lobbyScreenHeaderShrunk"); }, 600);
    setTimeout(function() { PlacelobbyScreenBadgeCss(myActiveIndex, myBadge);              }, 600);

    const badgeDisplayStaggerTime = Math.min(100,1000/activePlayerList.length);
    for (let playerLooper = 0; playerLooper < activePlayerList.length; playerLooper++) {
        if (activePlayerList[playerLooper].playerKey === myPlayerData.playerKey) { continue; }
        const playerBadge = GeneratelobbyScreenBadge(activePlayerList[playerLooper].playerKey);
        badgeWrapper.appendChild(playerBadge);
        playerBadge.style.fontSize = "";
        setTimeout(function() { PlacelobbyScreenBadgeCss(playerLooper, playerBadge) }, 600  + playerLooper*badgeDisplayStaggerTime);
    }

    const lobbyScreenFooter = document.createElement("div");
    lobbyScreenFooter.classList.add("lobbyScreenFooter", "lobbyScreenFooterShrunk");
    lobbyScreenWrapper.appendChild(lobbyScreenFooter);

    const lobbyScreenStartButton = document.createElement("button");
    lobbyScreenStartButton.classList.add("lobbyScreenStartButton");
    lobbyScreenStartButton.textContent = "Start Game!";
    lobbyScreenStartButton.onclick = function() { StartGame(); };
    lobbyScreenFooter.appendChild(lobbyScreenStartButton);
    const lobbyScreenStartButtonGlow = document.createElement("div");
    lobbyScreenStartButtonGlow.classList.add("lobbyScreenStartButtonGlow");
    lobbyScreenFooter.appendChild(lobbyScreenStartButtonGlow);

    const lobbyScreenLeaveButton = document.createElement("button");
    lobbyScreenLeaveButton.classList.add("lobbyScreenLeaveButton");
    lobbyScreenLeaveButton.textContent = "Leave";
    lobbyScreenLeaveButton.onclick = function() { LeaveGame(); };
    lobbyScreenFooter.appendChild(lobbyScreenLeaveButton);

    const qrCodeFooterDiv = document.createElement("div");
    qrCodeFooterDiv.classList.add("qrCodeFooterDiv");
    const qrcode = new QRCode(qrCodeFooterDiv, { width : 500, height : 500 });
    qrcode.makeCode(`https://www.simplyanything.ca?room=${roomData.roomCode}`);
    qrCodeFooterDiv.getElementsByTagName("img")[0].classList.add("qrCode");
    qrCodeFooterDiv.getElementsByTagName("img")[0].classList.add("qrCodeShrink");
    qrCodeFooterDiv.onclick = function() {
        qrCodeFooterDiv.getElementsByTagName("img")[0].classList.toggle("qrCodeShrink");
    }

    if (activePlayerList.length > 1) {
        setTimeout(function() { lobbyScreenFooter.classList.remove("lobbyScreenFooterShrunk"); }, 600 + activePlayerList.length * badgeDisplayStaggerTime);
    }

    setTimeout(() => { sessionData.animating = false; }, 600 + activePlayerList.length * badgeDisplayStaggerTime + 500);
}

function RegeneratelobbyScreen() {
    sessionData.animating = true;
    if(!document.getElementById("lobbyScreenWrapper")) { GeneratelobbyScreen(); return; }
    const mainWrapper = document.getElementById("MainWrapper");

    const badgeWrapper = mainWrapper.querySelector(".badgeWrapper");
    const lobbyScreenFooter = mainWrapper.querySelector(".lobbyScreenFooter");
    if(!badgeWrapper || !lobbyScreenFooter) { GeneratelobbyScreen(); return; }

    const playerBadges = document.querySelectorAll(".lobbyScreenBadge");
    const activePlayerList = playerList.filter(player => player.active == "1");
    const badgeDisplayStaggerTime = Math.min(100,1000/activePlayerList.length);


    // Stop any upcoming badge removals, they might be based on old data
    sessionData.badgeRemovals.forEach(removal => { clearTimeout(removal); });
    sessionData.badgeRemovals = [];

    // Remove badge for inactive players
    playerBadges.forEach(badge => {
        if(!activePlayerList.find(player => player.playerKey == badge.getAttribute("playerkey"))) {
            badge.style.transform = "scale(0)";
            sessionData.badgeRemovals.push(setTimeout( function() { badge.remove(); }, 500*sessionData.animationSpeed));
        }
    });


    // Create badges for active players, if needed
    activePlayerList.forEach((player, listIndex) => {
        let playerBadge = document.querySelector(`.lobbyScreenBadge[playerkey="${player.playerKey}"]`);

        // Make a new badge for new players
        if(!playerBadge) { playerBadge = badgeWrapper.appendChild(GeneratelobbyScreenBadge(player.playerKey)); }

        // Put all active player badges in the right place
        playerBadge.style.transform = "";
        setTimeout( function() { PlacelobbyScreenBadgeCss(listIndex, playerBadge); }, listIndex*badgeDisplayStaggerTime );
    });


    // Show the game start button iff there are at least 2 players
    if (activePlayerList.length > 1)  {
        setTimeout(function() { lobbyScreenFooter.classList.remove("lobbyScreenFooterShrunk"); }, 600 + activePlayerList.length * badgeDisplayStaggerTime);
    } else {
        lobbyScreenFooter.classList.add("lobbyScreenFooterShrunk");
    }

    setTimeout(() => { sessionData.animating = false; }, 600 + activePlayerList.length * badgeDisplayStaggerTime + 500);
}

function GeneratelobbyScreenBadge(playerKey) {
    const currentPlayer = playerList.find(player => {return player.playerKey == playerKey})
    const playerBadge = document.createElement("div");
    playerBadge.setAttribute("name", "lobbyScreenbadge");
    playerBadge.setAttribute("playerkey", currentPlayer.playerKey);
    playerBadge.classList.add("lobbyScreenBadge", "glassCard");
        const playerBadgeName = document.createElement("div");
        playerBadgeName.classList.add("playerBadgeName");
        playerBadgeName.innerHTML = EmojiHash(currentPlayer.playerName + currentPlayer.playerKey) + " " + currentPlayer.playerName;
        playerBadge.appendChild(playerBadgeName);

    return playerBadge;
}

function PlacelobbyScreenBadgeCss(playerIndex, badge) {
    const activePlayerList = playerList.filter(player => player.active == "1");
    const numberOfPlayers  = activePlayerList.length;
    const numberOfColumns  = Math.ceil(Math.sqrt(numberOfPlayers / sessionData.rowsPerColumn)); // A+ to anyone who can explain this to me
    const numberOfRows     = numberOfColumns * sessionData.rowsPerColumn;

    const rowHeight   = (60  / numberOfRows); // true vh
    const columnWidth = (100 / numberOfColumns); // vw

    /* All 0 indexed */
    const currentRow    = Math.floor(playerIndex / numberOfColumns);
    const currentColumn = ((playerIndex) % numberOfColumns);
    const badgeTruevhHeight = rowHeight * 0.9;
    const badgeTruevhTop = currentRow * rowHeight;

    badge.style.height = `calc(${badgeTruevhHeight} * var(--truevh))`;
    badge.style.width  = columnWidth*0.8 + "%";
    badge.style.top  = `calc(${badgeTruevhTop} * var(--truevh))`;
    badge.style.left = (columnWidth*0.1 + (currentColumn * columnWidth)) + "%";

    badge.style.borderRadius = (rowHeight/4) + "vh";
    badge.style.opacity      = "1";
    badge.style.fontSize = "";
}

function ResizeBadgePlayername(badge) {
    if (badge.scrollWidth > badge.clientWidth || badge.scrollHeight > badge.clientHeight) {
        const fontSizeFactor = Math.min((badge.clientWidth / badge.scrollWidth), (badge.clientHeight / badge.scrollHeight));
        const badgeFontSize = parseFloat(window.getComputedStyle(badge).fontSize) * fontSizeFactor * 0.95;
        badge.style.fontSize = badgeFontSize + "px";
    }
    
}

function DeconstructlobbyScreen() {
    sessionData.animating = true;

    setTimeout(function() { document.querySelector(".lobbyScreenFooter")?.classList.add("lobbyScreenFooterShrunk")},  500);
    setTimeout(function() { document.querySelector(".lobbyScreenHeader")?.classList.add("lobbyScreenHeaderShrunk")},  500);
    setTimeout(function() { document.querySelectorAll(".lobbyScreenBadge").forEach(badge => {   badge.style.height = "0"; badge.style.width = "0"; badge.style.opacity = "0";  });  },  500);
    setTimeout(function() { document.querySelectorAll(".lobbyScreenBadge").forEach(badge => {   badge.remove(); });  }, 1000);
    setTimeout(function() { document.querySelector(".lobbyScreenWrapper")?.remove(); }, 1000);

    setTimeout(() => { sessionData.animating = false; }, 1000);
}
} // Waiting screen region


// Action screen region
{
function GenerateActionScreen(normalSpeed) {
    // If action screen has already been generated, return.
    // Can happen when game becomes visible, but isn't reloaded. (e.g. minimized window)
    if(document.getElementById("actionScreenWrapper")) { return; }
    const mainWrapper = document.getElementById("MainWrapper");

    document.getElementById("footerDiv").style.display = "";
    document.getElementById("footerScoreText").innerHTML = myPlayerData.playerScore;

    const actionScreenWrapper = document.createElement("div");
    actionScreenWrapper.id = "actionScreenWrapper";
    actionScreenWrapper.classList.add("actionScreenWrapper");
    mainWrapper.appendChild(actionScreenWrapper);

    // Space for "Do this:" (if currently acting) or "Watch..."
    const actionScreenHeader = document.createElement("div");
    actionScreenHeader.classList.add("actionScreenHeader");
    actionScreenHeader.id = "actionScreenHeader";
    actionScreenWrapper.appendChild(actionScreenHeader);

    // Space for the instructions (if currently acting) or the possible answers
    const actionScreenContent = document.createElement("div");
    actionScreenContent.id = "actionScreenContent";
    actionScreenWrapper.appendChild(actionScreenContent);

    // Space for the progress bar (if currently acting) or other players (if not)
    const actionScreenFooter = document.createElement("div");
    actionScreenFooter.id = "actionScreenFooter";
    if(normalSpeed) {
        actionScreenFooter.style.opacity = "0";
        setTimeout(() => { actionScreenFooter.style.opacity = ""; }, 500);    
    }
    actionScreenWrapper.appendChild(actionScreenFooter);
}

function PopulateActionScreen(normalSpeed) {
    sessionData.animating = true;

    GenerateActionScreen(normalSpeed);

    const actionScreenHeader    = document.getElementById("actionScreenHeader");
    const actionScreenContent   = document.getElementById("actionScreenContent");
    const actionScreenFooter    = document.getElementById("actionScreenFooter");
    const mainWrapper = document.getElementById("MainWrapper");

    // Your turn to act
    if (roomData.roomCurrentPlayer == myPlayerData.playerIndex) {

        // If the screen is already populated, just update the bar
        if(mainWrapper.querySelector(".cardTextDiv")) {
            UpdateProgressBar();
            setTimeout(() => { sessionData.animating = false; }, 500);
            return;
        }

        actionScreenHeader.innerHTML = "Do this:";

        const actionScreenCardDiv = document.createElement("div");
        actionScreenCardDiv.id = "actionScreenCardDiv";
        actionScreenCardDiv.classList.add("actionScreenCardDiv");
        actionScreenCardDiv.classList.add("glassCard");
        actionScreenCardDiv.classList.add("actionScreenCardShrunkDiv");
        actionScreenContent.append(actionScreenCardDiv);

        const cardText = StringTo2ndPerson(roomData.roomCard.card_command) + " " + StringTo2ndPerson(roomData.roomCard.questions.find(question => question.question_index == roomData.roomCorrectAnswer).question_text);
        const cardTextDiv = document.createElement("div");
        cardTextDiv.innerHTML = cardText;
        cardTextDiv.classList.add("cardTextDiv");
        actionScreenCardDiv.appendChild(cardTextDiv);
        const cardFooterDiv = document.createElement("div");
        cardFooterDiv.innerHTML = "Simply Anything";
        cardFooterDiv.classList.add("cardFooterDiv");
        actionScreenCardDiv.appendChild(cardFooterDiv);
        setTimeout( function() { actionScreenCardDiv.classList.remove("actionScreenCardShrunkDiv"); }, 50 );

        actionScreenFooter.classList.add("actionScreenActorFooter");

        const actionScreenStatusText = document.createElement("div");
        actionScreenStatusText.classList.add("actionScreenStatusText");
        actionScreenFooter.appendChild(actionScreenStatusText);

        const actionScreenProgressBar = document.createElement("div");
        actionScreenProgressBar.classList.add("actionScreenProgressBar");
        actionScreenFooter.appendChild(actionScreenProgressBar);

        const progressBarFiller = document.createElement("div");
        progressBarFiller.classList.add("progressBarFiller");
        actionScreenProgressBar.appendChild(progressBarFiller);

        const actionScreenReveal = document.createElement("button");
        actionScreenReveal.id = "actionScreenRevealButton";
        actionScreenReveal.classList.add("lobbyScreenStartButton");
        actionScreenReveal.onclick = RevealAnswer;
        actionScreenFooter.appendChild(actionScreenReveal);

        UpdateProgressBar();
        setTimeout(() => { sessionData.animating = false; }, 500);

    } else { // Not your turn to act
        const currentActor = playerList.find(player => { return player.playerIndex == roomData.roomCurrentPlayer; });

        const actorBadge = document.createElement("div");
        actorBadge.setAttribute("name", "actionscreencurrentactorbadge");
        actorBadge.classList.add("actionscreencurrentactorbadge", "glassCard");
        actorBadge.classList.add("zeroAll");
    
        const playerBadgeName = document.createElement("div");
        playerBadgeName.classList.add("playerBadgeName");
        actorBadge.appendChild(playerBadgeName);

        if(currentActor) {
            actorBadge.setAttribute("playerkey", currentActor.playerKey);
            playerBadgeName.innerHTML = EmojiHash(currentActor.playerName + currentActor.playerKey) + " " + currentActor.playerName;
        } else {
            playerBadgeName.innerHTML = "🚫 No Actor";
        }

        const actionScreenHeaderTopLine = document.createElement("div");
        actionScreenHeaderTopLine.classList.add("actionScreenHeaderTopLine");

        actionScreenHeaderTopLine.innerHTML = "Watch:";
        actionScreenHeaderTopLine.style.whiteSpace = "nowrap";
        actionScreenHeaderTopLine.appendChild(actorBadge);
        actionScreenHeader.appendChild(actionScreenHeaderTopLine);
        actionScreenContent.classList.add("actionScreenQuestions");

        setTimeout(() => {
            actorBadge.classList.remove("zeroAll");
            ShrinkText(actionScreenHeaderTopLine, playerBadgeName);            
        }, 0);

        actorBadge.addEventListener("click", ToggleOverride);

        const questionCardsHeaderDiv = document.createElement("div");
        questionCardsHeaderDiv.classList.add("questionCardsHeaderDiv");
        questionCardsHeaderDiv.innerHTML = "What did they do?";
        actionScreenHeader.appendChild(questionCardsHeaderDiv);

        if(!actionScreenContent.querySelector(".questionCard")) {
            GenerateActionScreenQuestionCards(actionScreenContent, normalSpeed);
        }

        if(myPlayerData.playerChoice != null) {
            BlurQuestionCards(myPlayerData.playerChoice);
            PlaceGuessEmoji(myPlayerData.playerChoice);
        }

        actionScreenFooter.classList.add("actionScreenPlayerFooter");

        const thinkingText = document.createElement("div");
        thinkingText.classList.add("statusText");
        thinkingText.classList.add("dashedRight");
        thinkingText.innerHTML = "Thinking";
        actionScreenFooter.append(thinkingText);

        const guessedText = document.createElement("div");
        guessedText.classList.add("statusText");
        guessedText.innerHTML = "Guessed";
        actionScreenFooter.append(guessedText);

        const thinkingPlayersDiv = document.createElement("div");
        thinkingPlayersDiv.classList.add("statusList");
        thinkingPlayersDiv.classList.add("dashedRight");
        actionScreenFooter.append(thinkingPlayersDiv);

        const guessedPlayersDiv = document.createElement("div");
        guessedPlayersDiv.classList.add("statusList");
        actionScreenFooter.append(guessedPlayersDiv);

        const activePlayers   = playerList.filter(player => {return player.playerIndex != roomData.roomCurrentPlayer && player.active == 1});
        const thinkingPlayers = playerList.filter(player => {return player.playerIndex != roomData.roomCurrentPlayer && player.active == 1 && player.playerChoice === null});
        const guessedPlayers  = playerList.filter(player => {return player.playerIndex != roomData.roomCurrentPlayer && player.active == 1 && player.playerChoice !=  null});

        setTimeout(() => { sessionData.animating = false; }, (roomData.roomCard.questions.length + 1) * (normalSpeed ? 100 : 10) + 500);
    }
}

function ToggleLeaveRoom(event) {
    event.stopPropagation();
    if(document.querySelector(".leaveRoomWrapper")) {
        RemoveLeaveRoom();
        return;
    }
    const footerRoomLocation = document.getElementById("footerRoomWrapper").getBoundingClientRect();
    const mainWrapper = document.getElementById("MainWrapper");

    const leaveRoomWrapper = document.createElement("div");
    leaveRoomWrapper.classList.add("leaveRoomWrapper");
    leaveRoomWrapper.style.left   = footerRoomLocation.left + (footerRoomLocation.width/4) + "px"; // Lines up the speech bubble
    leaveRoomWrapper.style.width  = footerRoomLocation.width-1 + "px"; // The footer element has a 1px right border
    leaveRoomWrapper.style.bottom = "calc(var(--footer-height) * var(--truevh))";  // The top of the footer is the bottom of the wrapper
    leaveRoomWrapper.style.height = footerRoomLocation.width * 0.75 + "px";  // the popup is a 4:3 rectangle
    leaveRoomWrapper.style.zIndex = "20";
    mainWrapper.append(leaveRoomWrapper);

    const leaveRoomText = document.createElement("div");
    leaveRoomText.classList.add("leaveRoomText");
    leaveRoomText.innerHTML = "Leave Room";
    leaveRoomText.onclick = LeaveGame;
    leaveRoomWrapper.append(leaveRoomText);

    ShrinkText(leaveRoomText);
}

function RemoveLeaveRoom() {
    const mainWrapper = document.getElementById("MainWrapper");
    const leaveRoomWrapper = mainWrapper.querySelector(".leaveRoomWrapper");
    if(leaveRoomWrapper) { leaveRoomWrapper.remove(); }
}

function ToggleOverride(event) {
    event.stopPropagation();

    if(document.querySelector(".overrideWrapper")) {
        RemoveOverride();
        return;
    }
    const srcElement = event.currentTarget;
    const menuTop = srcElement.getBoundingClientRect().bottom;
    const menuLeft = srcElement.getBoundingClientRect().left;
    const menuWidth = srcElement.getBoundingClientRect().width;
    const triangleDiv = document.createElement("div");
    triangleDiv.classList.add("triangleUp");
    triangleDiv.style.top = (menuTop-10) + "px";
    triangleDiv.style.left = (menuLeft + (menuWidth/2) -10) + "px";

    const mainWrapper = document.getElementById("MainWrapper");
    mainWrapper.append(triangleDiv);

    const overrideWrapper = document.createElement("div");
    overrideWrapper.classList.add("overrideWrapper");
    overrideWrapper.style.top = (menuTop+10) + "px";
    overrideWrapper.style.left = menuLeft + "px";
    overrideWrapper.style.width = menuWidth + "px";
    switch (roomData.roomGameState) {
        case 1:
            overrideWrapper.innerHTML = "Reveal";
            overrideWrapper.onclick = RevealAnswer;
            break;
        case 2:
            overrideWrapper.innerHTML = "Next";
            overrideWrapper.onclick = ProgressQuestions;
            break;
    }    
    mainWrapper.append(overrideWrapper);
}

function RemoveOverride() {
    if(!document.querySelector(".overrideWrapper")) { return; }

    document.querySelector(".triangleUp").style.opacity = 0;
    document.querySelector(".overrideWrapper").style.opacity = 0;
    setTimeout(() => {
        document.querySelector(".triangleUp")?.remove();
        document.querySelector(".overrideWrapper")?.remove();
    }, 500);
}

function BlurQuestionCards(questionIndex) {
    const activeCard = document.querySelector(`.questionCard[questionindex='${questionIndex}']`);
    document.querySelectorAll(".questionCard").forEach(questionCard => { questionCard.classList.add("questionCardBlured"); });
    activeCard.classList.remove("questionCardBlured");
}

function PlaceGuessEmoji(questionIndex) {
    const activeCard = document.querySelector(`.questionCard[questionindex='${questionIndex}']`);
    document.querySelectorAll(".questionCard").forEach(questionCard => { questionCard.classList.remove("glassCardSelected"); });
    activeCard.classList.add("glassCardSelected");

    document.querySelectorAll(".questionCardEmoji").forEach(questionCardEmoji => { questionCardEmoji.innerHTML = ""; });
    activeCard.querySelector(".questionCardEmoji").innerHTML = EmojiHash(myPlayerData.playerName + myPlayerData.playerKey);
}

function RemoveGuess() {
    document.querySelectorAll(".questionCard").forEach(questionCard => { questionCard.classList.remove("questionCardBlured"); });
    document.querySelectorAll(".questionCardEmoji").forEach(questionCardEmoji => { questionCardEmoji.innerHTML = ""; });
}

function RevealActorResults(normalSpeed) {
    sessionData.animating = true;


    // Generate the action screen if needed.
    // Happens when rejoining a game (e.g. refresh page)
    GenerateActionScreen(normalSpeed);

    const actionScreenHeader    = document.getElementById("actionScreenHeader");
    const actionScreenContent   = document.getElementById("actionScreenContent");
    const actionScreenFooter    = document.getElementById("actionScreenFooter");


    // Clear or hide content in the action screen
    actionScreenHeader.style.fontSize = "0";
    actionScreenContent.innerHTML = "";
    actionScreenFooter.style.opacity = "0";


    // For the results screen content, the actor will see all question cards
    actionScreenContent.classList.add("actionScreenQuestions");


    // For the results screen footer, the actor will see everyone's results, not the progress bar
    actionScreenFooter.classList.remove("actionScreenActorFooter");
    actionScreenFooter.classList.add("actorResultsFooterDiv");



    setTimeout(() => {
        actionScreenHeader.innerHTML = "Everyone's guess...";
        actionScreenHeader.style.fontSize = "";

        actionScreenFooter.innerHTML = "";
        actionScreenFooter.style.opacity = "1";
    },  500);

    setTimeout(() => {
        // Make all the question cards to show the actor
        GenerateActionScreenQuestionCards(actionScreenContent, normalSpeed);
    },  1000);


    // Show which players picked which question card
    setTimeout(() => { PopulateQuestionCardEmoji(); },  2500);


    setTimeout(() => {
        // Blur all the wrong answer cards
        BlurQuestionCards(roomData.roomCorrectAnswer);

        const footerText = document.createElement("div");
        footerText.classList.add("footerText");
        actionScreenFooter.append(footerText);

        const guessedCorrectly = playerList.filter((player) => player.playerChoice == roomData.roomCorrectAnswer);
        const guessedSomething = playerList.filter((player) => player.playerChoice != null);

        document.getElementById("footerScoreText").innerHTML = myPlayerData.playerScore;

        // No one guessed
        if (guessedSomething.length == 0) { footerText.innerHTML = "No one had made a guess. 😞"; }

        // One person guessed
        else if (guessedSomething.length == 1) {
            const playerName = guessedSomething[0].playerName;
            if(guessedCorrectly.length == 1) {
                footerText.innerHTML = playerName + " guessed right! 😄";
                ConfettiBlast(1.5);
            } else {
                footerText.innerHTML = playerName + " guessed wrong! 😞";
            }
        }

        // Multiple people guessed
        else {
            if(guessedCorrectly.length == 1) {
                footerText.innerHTML = "Only " + guessedCorrectly[0].playerName + " was right! 😲";
            } else if (guessedCorrectly.length == guessedSomething.length) {
                footerText.innerHTML = "Everyone's right! 🥳";
                ConfettiBlast(2);
            } else {
                //footerTextDiv.innerHTML = guessedCorrectly.length + " of " + guessedSomething.length + " (" + Math.round((guessedCorrectly.length / guessedSomething.length)*100) + "%) right! ";
                footerText.innerHTML = `${guessedCorrectly.length} of ${guessedSomething.length} right`;
                if      ((guessedCorrectly.length / guessedSomething.length) >= 0.75) { footerText.innerHTML += "! 🥳"; ConfettiBlast(1.5); }
                else if ((guessedCorrectly.length / guessedSomething.length) >= 0.50) { footerText.innerHTML += "! 😊"; ConfettiBlast(1); }
                else if ((guessedCorrectly.length / guessedSomething.length) >= 0.25) { footerText.innerHTML += ". 🤔"; }
                else                                                                  { footerText.innerHTML += "... 😞"; }
            }
        }
        while(footerText.scrollWidth > footerText.clientWidth) {
            footerText.style.fontSize = parseFloat(window.getComputedStyle(footerText).fontSize)*0.98 + "px";
        }
        footerText.style.fontSize = parseFloat(window.getComputedStyle(footerText).fontSize)*0.9 + "px";
    },  4500);

    setTimeout(() => {
        const progressQuestionButton = document.createElement("button");
        progressQuestionButton.classList.add("lobbyScreenStartButton");
        progressQuestionButton.textContent = "Next >>";
        progressQuestionButton.onclick = ProgressQuestions;
        actionScreenFooter.appendChild(progressQuestionButton);
    },  11000);

    setTimeout(() => { sessionData.animating = false; }, 11000);
}


function RevealResults() {
    sessionData.animating = true;
    document.querySelector(".actionScreenQuestions").addEventListener("click", function(event) { event.stopImmediatePropagation(); }, true);
    document.querySelectorAll(".questionCard").forEach(questionCard => { questionCard.classList.remove("questionCardBlured"); });

    const correctQuestionCard = document.querySelector(`.questionCard[questionindex="${roomData.roomCorrectAnswer}"]`)
    const actionScreenWrapper = document.getElementById("actionScreenWrapper");
    const questionCardsHeaderDiv = document.querySelector(".questionCardsHeaderDiv");
    const playerCorrect = (roomData.roomCorrectAnswer == myPlayerData.playerChoice);
    const myScore = myPlayerData.playerScore;
    const footerScoreText = document.getElementById("footerScoreText");

    questionCardsHeaderDiv.style.fontSize = "0";

    const actionScreenCover = document.createElement("div");
    actionScreenCover.classList.add("actionScreenCover");
    actionScreenCover.style.opacity = "0";
    actionScreenCover.innerHTML = "Time's up!";
    actionScreenWrapper.appendChild(actionScreenCover);

    // This is the animation to reveal the answer dramatically!
    setTimeout(function() { actionScreenCover.style.opacity  = "1";          }, 50);
    setTimeout(function() { RemoveOverride();                                }, 50);
    setTimeout(function() { actionScreenCover.style.fontSize = "0";          }, 2000);
    setTimeout(function() { actionScreenCover.style.fontSize = ""; actionScreenCover.innerHTML = "Everyone's<br/>answers..."; questionCardsHeaderDiv.innerHTML = "Everyone's answers..."; questionCardsHeaderDiv.style.fontSize = ""; }, 2500);
    setTimeout(function() { actionScreenCover.style.fontSize = "0";          }, 4500);
    setTimeout(function() { actionScreenCover.style.opacity  = "0";          }, 5000);
    setTimeout(function() { actionScreenCover.style.display  = "none";       }, 5500);
    setTimeout(function() { PopulateQuestionCardEmoji();                     }, 6000); // Max 1.5s
    setTimeout(function() { questionCardsHeaderDiv.style.fontSize = "0";     }, 7500);
    setTimeout(function() { questionCardsHeaderDiv.style.fontSize = ""; questionCardsHeaderDiv.innerHTML = "The answer is..."; }, 8000);
    setTimeout(function() { BlurQuestionCards(roomData.roomCorrectAnswer);   }, 10000);
    setTimeout(function() { correctQuestionCard.classList.add("bigGlow");    }, 10000);
    setTimeout(function() { if(playerCorrect) { ConfettiBlast(2); }          }, 10000);
    setTimeout(function() { footerScoreText.innerHTML = myScore;             }, 10000);
    setTimeout(function() { correctQuestionCard.classList.add("smallGlow");  }, 10500);
    setTimeout(function() { correctQuestionCard.classList.remove("bigGlow"); }, 10500);

    setTimeout(() => { sessionData.animating = false; }, 10500);
}


// Game is reloaded while answers are revealed
function RerevealResults() {
    document.querySelector(".actionScreenQuestions").addEventListener("click", function(event) { event.stopImmediatePropagation(); }, true);
    document.querySelectorAll(".questionCard").forEach(questionCard => { questionCard.classList.remove("questionCardBlured"); });

    const correctQuestionCard = document.querySelector(`.questionCard[questionindex="${roomData.roomCorrectAnswer}"]`)
    const questionCardsHeaderDiv = document.querySelector(".questionCardsHeaderDiv");
    const playerCorrect = (roomData.roomCorrectAnswer == myPlayerData.playerChoice);

    questionCardsHeaderDiv.innerHTML = "The answer is...";
    PopulateQuestionCardEmoji();
    BlurQuestionCards(roomData.roomCorrectAnswer);
    correctQuestionCard.classList.add("smallGlow");
    if(playerCorrect) { ConfettiBlast(1); }
    document.getElementById("footerScoreText").innerHTML = myPlayerData.playerScore;
}


function PopulateQuestionCardEmoji() {
    document.querySelectorAll(".questionCardEmoji").forEach(questionCardEmoji => { questionCardEmoji.innerHTML = ""; });

    playerList.forEach((player, emojiIndex) => {
        // Don't add an emoji for the actor
        if (player.playerIndex == roomData.roomCurrentPlayer) { return; }

        // Find the question card this player choose
        const currentQuestionCard = document.querySelector(`.questionCard[questionindex='${player.playerChoice}']`);
        if (!currentQuestionCard) { return; }

        // Find the card footer (which holds emoji)
        const currentQuestionCardEmoji = currentQuestionCard.querySelector(".questionCardEmoji");

        // Add the player's emoji to the footer, then check for overflow
        const emojiStaggerTime = Math.min(100, 1000/playerList.length);
        setTimeout( function() {
            currentQuestionCardEmoji.innerHTML += EmojiHash(player.playerName + player.playerKey);
            if(currentQuestionCard.scrollHeight > currentQuestionCard.clientHeight) {
                currentQuestionCardEmoji.style.letterSpacing = Math.max(-10, parseInt(currentQuestionCardEmoji.style.letterSpacing)-2) + "px";
            }
            ShrinkText(currentQuestionCard);
        }, emojiIndex*emojiStaggerTime);
    });
}

function UpdateProgressBar() {
    const activeGuesserList = playerList.filter(player => player.active == "1" && player.playerIndex != roomData.roomCurrentPlayer);
    const guessedPlayersCount = activeGuesserList.map(player => player.playerChoice).reduce((total, choice) => (choice != null) ? total + 1 : total, 0);
    const progressBarPercent = Math.max(3, guessedPlayersCount / (Math.max(1, activeGuesserList.length)) * 100);
    document.querySelector(".progressBarFiller").style.width = progressBarPercent + "%";
    if(guessedPlayersCount == activeGuesserList.length && activeGuesserList.length > 0) {
        document.querySelector(".actionScreenStatusText").innerHTML = "Everyone has guessed!";
        document.getElementById("actionScreenRevealButton").textContent = "Reveal";
        document.getElementById("actionScreenRevealButton").classList.remove("spinnerBackground");
    } else if (guessedPlayersCount < activeGuesserList.length) {
        document.querySelector(".actionScreenStatusText").innerHTML = "Players are guessing...";
        document.getElementById("actionScreenRevealButton").textContent = "Wait...";
        document.getElementById("actionScreenRevealButton").classList.add("spinnerBackground");
    } else {
        document.querySelector(".actionScreenStatusText").innerHTML = "No other players...";
        document.getElementById("actionScreenRevealButton").textContent = "Wait...";
        document.getElementById("actionScreenRevealButton").classList.add("spinnerBackground");
    }
}

function GenerateActionScreenQuestionCards(contentDiv, normalSpeed) {
    roomData.roomCard.questions.forEach((question, index) => {
        let currentQuestionCard = GenerateActionScreenQuestionCard(question);
        contentDiv.appendChild(currentQuestionCard);
        setTimeout(function() {
            currentQuestionCard.classList.add("questionCardExpanded");
            setTimeout(function() { ShrinkText(currentQuestionCard); }, 500);
        }, (index+1)* normalSpeed ? 100 : 10);
    });
}

function GenerateActionScreenQuestionCard(question) {
    const questionCard = document.createElement("div");
    const questionIndex = question.question_index;
    questionCard.classList.add("glassCard", "questionCard", "zeroAll");
    questionCard.setAttribute("questionindex", questionIndex);
    questionCard.innerHTML = StringTo3rdPerson(roomData.roomCard.card_command) + " " + StringTo3rdPerson(question.question_text);
    questionCard.addEventListener("click", function() { SendGuess(questionIndex); })

    const currentQuestionCardEmoji = document.createElement("div");
    currentQuestionCardEmoji.classList.add("questionCardEmoji");
    currentQuestionCardEmoji.style.letterSpacing = "0px"; // Set at element level to make changing easier later
    questionCard.appendChild(currentQuestionCardEmoji);

    return questionCard;
}

function RefreshActionScreen() {
    // Player is the actor
    if(roomData.roomCurrentPlayer === myPlayerData.playerIndex) {
        setTimeout(() => { UpdateProgressBar(); }, 0);
    }
}
} // Action screen region

// Universal UI functions region
{
function ClearScreen() {
    const potentialElements = ["newGameDiv", "newGameCircleDiv", "joinGameDiv", "joinGameCircleDiv", "rejoinGameDiv", "rejoinGameCircleDiv", "lobbyScreenWrapper", "actionScreenWrapper"];
    potentialElements.forEach(element => {
        if (document.getElementById(element)) {
            document.getElementById(element).remove();
        }
    });    
}
} // Universal UI functions region

//#endregion UI


//#region Send events
function NewGame() {
    if(sessionData.animating) { return; }
    const newGameNameTextbox = document.getElementById("newGameNameTextbox");

    const playerName = newGameNameTextbox.value;
    if(playerName == "") {
        newGameNameTextbox.classList.add("attentionGlow");
        setTimeout(() => { newGameNameTextbox.classList.remove("attentionGlow"); }, 1000);
        return;
    }

    myPlayerData.playerName = document.getElementById("newGameNameTextbox").value;
    if(myPlayerData.playerName === null) { return; }
    DeconstructFirstScreen();

    const requestData = {};
    requestData.playerName = myPlayerData.playerName;
    socket.emit('request game', requestData);
}

function JoinGame() {
    if (sessionData.animating) { return; }
    const joinGameNameTextbox = document.getElementById("joinGameNameTextbox");
    const joinGameRoomcodeTextbox = document.getElementById("joinGameRoomcodeTextbox");

    if(joinGameNameTextbox.value == "") {
        joinGameNameTextbox.classList.add("attentionGlow");
        setTimeout(() => { joinGameNameTextbox.classList.remove("attentionGlow"); }, 1000);
        return;
    }

    if(joinGameRoomcodeTextbox.value == "") {
        joinGameRoomcodeTextbox.classList.add("attentionGlow");
        setTimeout(() => { joinGameRoomcodeTextbox.classList.remove("attentionGlow"); }, 1000);
        return;
    }

    myPlayerData.playerName = joinGameNameTextbox.value;
    roomData.roomCode = joinGameRoomcodeTextbox.value.toUpperCase();
    if(myPlayerData.playerName === null || roomData.roomCode === null) { return; }
    DeconstructFirstScreen();

    const joinData = {};
    joinData.playerName = myPlayerData.playerName;
    joinData.roomCode = roomData.roomCode;

    // These are useful if the player can rejoin, but selects "join"
    joinData.playerKey = myPlayerData.playerKey;
    joinData.playerSecret = myPlayerData.playerSecret;

    socket.emit('join game', joinData);
}

function StartGame() {
    document.getElementsByClassName("lobbyScreenStartButton")[0].blur();
    document.querySelector(".lobbyScreenStartButtonGlow").classList.add("lobbyScreenStartButtonGlowExpand");

    const startData = {};
    startData.roomCode = roomData.roomCode;
    startData.playerKey = myPlayerData.playerKey;
    startData.playerSecret = myPlayerData.playerSecret;
    socket.emit('start game', startData);
}

function LeaveGame() {
    const leaveData = {};
    leaveData.playerKey = myPlayerData.playerKey;
    leaveData.playerSecret = myPlayerData.playerSecret;
    socket.emit('leave game', leaveData);
}

function SendGuess(questionIndex) {
    if(roomData.roomGameState == 2) { return; } // Answer has already been revealed.
    console.log("Sending guess.");

    // Undo a guess by tapping the active card
    if(questionIndex == myPlayerData.playerChoice) {
        RemoveGuess();
        myPlayerData.playerChoice = null;
    }

    // Make a new guess
    else {
        BlurQuestionCards(questionIndex);
        PlaceGuessEmoji(questionIndex);
        myPlayerData.playerChoice = questionIndex;    
    }

    const guessData = {};
    guessData.playerKey = myPlayerData.playerKey;
    guessData.playerSecret = myPlayerData.playerSecret;
    guessData.roomCode = roomData.roomCode;
    guessData.questionIndex = myPlayerData.playerChoice;
    socket.emit('send guess', guessData);
}

function RevealAnswer(event) {
    event.srcElement.onclick = null;
    console.log("Revealing answer...");

    const actionScreenRevealButton = document.getElementById("actionScreenRevealButton");
    if(actionScreenRevealButton) { actionScreenRevealButton.textContent = "Revealing..."; }

    const overrideWrapper = document.querySelector(".overrideWrapper");
    if(overrideWrapper) { overrideWrapper.classList.add("overrideWrapperSpinner"); }

    const revealData = {};
    revealData.roomCode = roomData.roomCode;
    revealData.playerKey = myPlayerData.playerKey;
    revealData.playerSecret = myPlayerData.playerSecret;
    socket.emit('reveal answer', revealData);
}

function ProgressQuestions(event) {
    event.srcElement.onclick = null;
    const overrideWrapper = document.querySelector(".overrideWrapper");
    if(overrideWrapper) { overrideWrapper.classList.add("overrideWrapperSpinner"); }

    const progressData = {};
    progressData.roomCode = roomData.roomCode;
    progressData.playerKey = myPlayerData.playerKey;
    progressData.playerSecret = myPlayerData.playerSecret;
    socket.emit('progress questions', progressData);
}

function RejoinGame() {
    if(socket.connected === false) { sessionData.connectionEvents.push(RejoinGame); return; }
    if(myPlayerData.playerKey === null || myPlayerData.playerSecret === null) { return; }

    const rejoinData = {};
    rejoinData.playerKey = myPlayerData.playerKey;
    rejoinData.playerSecret = myPlayerData.playerSecret;
    socket.emit('rejoin game', rejoinData);
}
//#endregion



//#region Hear game events
function GameCreated(msg) {
    if(!ReadMsg(msg, true)) { ClearLocalData(); ClearScreen(); GenerateLoadingScreen(); return; }

    roomData.roomGameState = 0;
    if (playerList.length != 1) { return; } /* TODO error message, problems. If you create a room, you must be the first (and only) player. */

    console.log("Room " + roomData.roomCode + " created by " + myPlayerData.playerName + "!");
    setTimeout(function(){ GeneratelobbyScreen(); }, 500);
}

function GameJoined(msg) {
    if(!ReadMsg(msg, true)) { ClearLocalData(); ClearScreen(); GenerateLoadingScreen(); return; }
    const playerIsActor = (roomData.roomCurrentPlayer == myPlayerData.playerIndex);

    console.log("Room " + roomData.roomCode + " joined by " + myPlayerData.playerName + "!");
    if (roomData.roomGameState == -1) { /* TODO show an error, rejoining non-existant room/game */ }
    if (roomData.roomGameState ==  0) { setTimeout(function(){ GeneratelobbyScreen(); }, 1500); }
    if (roomData.roomGameState ==  1) { setTimeout(function(){ PopulateActionScreen(true);  }, 1500); }
    if (roomData.roomGameState ==  2) {
        if (playerIsActor) { setTimeout(function(){ RevealActorResults();   }, 500); }
        else               { setTimeout(function(){ PopulateActionScreen(false); }, 1500); setTimeout(function(){ RerevealResults(); }, 1600); }
    }
}

function GameStarted(msg) {
    if(!ReadMsg(msg)) { ClearLocalData(); ClearScreen(); GenerateLoadingScreen(); return; }
    roomData.roomGameState = 1;

    console.log("Room " + roomData.roomCode + " started by " + myPlayerData.playerName + "!");
    if (document.querySelector(".lobbyScreenWrapper")) { DeconstructlobbyScreen(); }
    setTimeout(function(){ PopulateActionScreen(true);  }, 1500);
}

function GuessMade(msg) {
    if(!ReadMsg(msg)) { ClearLocalData(); ClearScreen(); GenerateLoadingScreen(); return; }

    console.log("Guess made.");
    if (roomData.roomCurrentPlayer == myPlayerData.playerIndex) {
        UpdateProgressBar();
    } else {
        // TODO can indicate guess was made in UI
        // TODO maybe blur on guess send, and place emoji on success
    }
}

function AnswerRevealed(msg) {
    if(!ReadMsg(msg)) { ClearLocalData(); ClearScreen(); GenerateLoadingScreen(); return; }
    roomData.roomGameState = 2;
    const playerIsActor = (roomData.roomCurrentPlayer == myPlayerData.playerIndex);

    console.log("Answer revealed.");
    if (playerIsActor) {
        RevealActorResults();
    } else {
        RevealResults();
    }
}

function QuestionsProgressed(msg) {
    if(!ReadMsg(msg)) { ClearLocalData(); ClearScreen(); GenerateLoadingScreen(); return; }
    roomData.roomGameState = 1;
    myPlayerData.playerChoice = null;
    RemoveOverride();

    const actionScreenWrapper = document.getElementById("actionScreenWrapper");
    actionScreenWrapper.style.opacity = "0";
    setTimeout(function() { actionScreenWrapper.remove(); }, 500)

    setTimeout(function(){ PopulateActionScreen(true); }, 500);
}

function GameRejoined(msg) {
    // Maybe room no longer exists
    if(!ReadMsg(msg, true)) { ClearLocalData(); ClearScreen(); GenerateLoadingScreen(); return; }

    const playerIsActor = (roomData.roomCurrentPlayer == myPlayerData.playerIndex);

    console.log(`Room ${roomData.roomCode} rejoined by me (${myPlayerData.playerName})!`);
    if (roomData.roomGameState == -1) { /* TODO show an error, rejoining non-existant room/game */ }
    if (roomData.roomGameState ==  0) { setTimeout(function(){ RegeneratelobbyScreen(); }, 100); }
    if (roomData.roomGameState ==  1) { setTimeout(function(){ PopulateActionScreen(true);  }, 100); }
    if (roomData.roomGameState ==  2) {
        if (playerIsActor) { setTimeout(function(){ RevealActorResults();   }, 100); }
        else               { setTimeout(function(){ PopulateActionScreen(false); }, 100); setTimeout(function(){ RerevealResults(); }, 200); }
    }
}

function GameLeft(msg) {
    ReadMsg(msg); // Should return "false", since player is no longer found in the game room
    ClearLocalData();
    ClearScreen();
    console.log("Room " + roomData.roomCode + " left by " + myPlayerData.playerName + "!");
    setTimeout(() => { window.location.replace(window.location.protocol + "//" + window.location.hostname + ":" + window.location.port); }, 500);
}

function PlayerJoined(msg) {
    if(!ReadMsg(msg)) { ClearLocalData(); ClearScreen(); GenerateLoadingScreen(); return; }

    // If I am the player that reconnected, no need to update the UI, everything is current
    if(msg.playerKey && msg.playerKey === myPlayerData.playerKey) { return; }

    console.log("Player (re)joined " + roomData.roomCode + ".");
    if (roomData.roomGameState == -1) { /* TODO show an error, someone joined a non-existant room/game */ }
    if (roomData.roomGameState ==  0) { RegeneratelobbyScreen();  }
    if (roomData.roomGameState ==  1) { RefreshActionScreen(); }
    if (roomData.roomGameState ==  2) { }
}

function PlayerDisconnected(msg) {
    if(!ReadMsg(msg)) { ClearLocalData(); ClearScreen(); GenerateLoadingScreen(); return; }

    console.log("Player disconnected");
    if (roomData.roomGameState == -1) { /* TODO show an error, someone left a non-existant room/game */ }
    if (roomData.roomGameState ==  0) { RegeneratelobbyScreen();  }
    if (roomData.roomGameState ==  1) { RefreshActionScreen(); }
    if (roomData.roomGameState ==  2) { }
}

function PlayerLeft(msg) {
    if(!ReadMsg(msg)) { ClearLocalData(); ClearScreen(); GenerateLoadingScreen(); return; }

    console.log("Player left");
    if (roomData.roomGameState == -1) { /* TODO show an error, someone left a non-existant room/game */ }
    if (roomData.roomGameState ==  0) { RegeneratelobbyScreen();  }
    if (roomData.roomGameState ==  1) { RefreshActionScreen(); }
    if (roomData.roomGameState ==  2) { }
}

function ReadMsg(msg, personal) {
    const returnedInfo = JSON.parse(msg);
    if (returnedInfo.success == false) { return false; }
    if (!returnedInfo.playerKey && !myPlayerData.playerKey) { return false; }  // I don't know my key, and a key isn't given = fail
    if (!myPlayerData.playerKey && !personal) { return false; }                // I don't know my key, and this message isn't mine = fail


    // Update game data if given
    if (returnedInfo.roomData)     { roomData = returnedInfo.roomData; }
    if (returnedInfo.playerList)   { playerList = returnedInfo.playerList; }


    // If this message is directed to only me: look for a secret, make a cookie, and update the footer
    if (personal) {
        if (returnedInfo.playerSecret) { myPlayerData.playerSecret = returnedInfo.playerSecret; }
        if (returnedInfo.playerKey)    { myPlayerData.playerKey = returnedInfo.playerKey; }

        // Store important data in cookie
        let cookieDate = new Date();
        cookieDate.setMonth(cookieDate.getMonth()+1);
        if(myPlayerData.playerKey)     { document.cookie = `playerKey=${myPlayerData.playerKey};       samesite=lax; expires=${cookieDate.toUTCString()}`; }
        if(myPlayerData.playerSecret)  { document.cookie = `playerSecret=${myPlayerData.playerSecret}; samesite=lax; expires=${cookieDate.toUTCString()}`; }
        if(roomData.roomCode)          { document.cookie = `roomCode=${roomData.roomCode};             samesite=lax; expires=${cookieDate.toUTCString()}`; }
    }


    // Look for player data about me and update my local copy
    // I'm not in the player's list => return false. Normal when: leaving a game / kicked for inactivity
    const myReturnedInfo = playerList.find(player => {return player.playerKey == myPlayerData.playerKey});
    if (myReturnedInfo === undefined) { console.log("My player info not found in msg"); return false; }
    Object.entries(myReturnedInfo).forEach(entry => { const [key, value] = entry; myPlayerData[key] = value; });


    // Footer content updates
    document.getElementById("footerRoomText").innerHTML   = roomData.roomCode;
    document.getElementById("footerPlayerIcon").innerHTML = EmojiHash(myPlayerData.playerName + myPlayerData.playerKey);
    document.getElementById("footerPlayerText").innerHTML = myPlayerData.playerName;
    ShrinkText(document.getElementById("footerPlayerWrapper"), document.getElementById("footerPlayerText"));    

    return true;
}
//#endregion


//#region Socket Functions
function ConnectSocket() {
    socket = io();
    socket.on('connect',              function()    { SocketConnected();        });
    socket.on('disconnect',           function()    { SocketDisconnected();     });

    // All the game events we have to listen for
    socket.on("game created",         function(msg) { GameCreated(msg);         });
    socket.on("game joined",          function(msg) { GameJoined(msg);          });
    socket.on("game rejoined",        function(msg) { GameRejoined(msg);        });
    socket.on("game left",            function(msg) { GameLeft(msg);            });
    socket.on("game started",         function(msg) { GameStarted(msg);         });
    socket.on("guess made",           function(msg) { GuessMade(msg);           });
    socket.on("answer revealed",      function(msg) { AnswerRevealed(msg);      });
    socket.on("questions progressed", function(msg) { QuestionsProgressed(msg); });
    socket.on("player joined",        function(msg) { PlayerJoined(msg);        });
    socket.on("player disconnected",  function(msg) { PlayerDisconnected(msg);  });
    socket.on("player left",          function(msg) { PlayerLeft(msg);          });
}

function SocketConnected() {
    ShowConnected();

    // These are all the functions we saved to run once we connect
    sessionData.connectionEvents.forEach(func => { func(); });
    sessionData.connectionEvents = [];
}

// If a socket connects, disconnects, then reconnects, the simplist way to reconnect all listeners is to reload the page.
function SocketReconnected() {
    setTimeout(() => { location.reload(); }, 1000*sessionData.animationSpeed);
}

function SocketDisconnected() {
    ShowDisconnected();
    sessionData.connectionEvents.push(SocketReconnected);
}

function ShowConnected() {
    const mainWrapper = document.getElementById("MainWrapper");

    // The spinner on the first bar of the loading screen (500ms delay avoids a flash)
    setTimeout(() => {  document.getElementById("headerTextDiv")?.classList.remove("headerLoading"); }, 500*sessionData.animationSpeed);


    // The offline display actions vanish instantly
    const offlineActions = mainWrapper.querySelector(".offlineActions");
    offlineActions.style.visibility = "hidden";

    // The offline display header text and colour change
    const offlineHeader = mainWrapper.querySelector(".offlineHeader");
    offlineHeader.innerHTML = "Reconnected";
    offlineHeader.classList.add("reconnect");

    // The offline display iself fades out
    const offlineCover = mainWrapper.querySelector(".offlineCover");
    setTimeout(() => { offlineCover.style.opacity = 0; }, 1000*sessionData.animationSpeed);

    // The whole display is reset to showing an "Offline" message
    setTimeout(() => {
        offlineHeader.innerHTML = "Game disconnected";
        offlineCover.style.display = "none";
        offlineHeader.classList.remove("reconnect");
        offlineActions.style.visibility = "";
    }, 1500*sessionData.animationSpeed);
}

function ShowDisconnected() {
    const mainWrapper = document.getElementById("MainWrapper");
    const offlineCover = mainWrapper.querySelector(".offlineCover");
    offlineCover.style.display = "flex";
    setTimeout(() => { offlineCover.style.opacity = 1; }, 0);
}
//#endregion


//#region Helper Functions
function ConfettiBlast(seconds) {
    var end = Date.now() + (seconds * 1000);
    var colors = ['#bb0000', '#ffffff'];

    (function frame() {
    confetti({
        particleCount: 2,
        angle: 60,
        spread: 55,
        origin: { x: 0 },
        colors: colors
    });
    confetti({
        particleCount: 2,
        angle: 120,
        spread: 55,
        origin: { x: 1 },
        colors: colors
    });

    if (Date.now() < end) {
        requestAnimationFrame(frame);
    }
    }());
}

function ClearLocalData() {
    // Clear important data cookies
    document.cookie = 'playerSecret=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
    document.cookie = 'playerKey=;    Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
    document.cookie = 'roomCode=;     Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';

    // Back to starting values
    roomData = {
        roomCode: null,
        roomGameState: null,
        roomCurrentPlayer: null,
        roomCard: {},
        roomCorrectAnswer: null,
        roomQuestionRevealed: false
    };

    myPlayerData.playerKey    = null;
    myPlayerData.playerSecret = null;
    myPlayerData.playerIndex  = null;
    myPlayerData.playerName   = null;
    myPlayerData.playerChoice = null;
    myPlayerData.playerScore  = 0;

    playerList = [];
}

function ShowQR() {
    const qrDivWrapper = document.getElementById("qrDivWrapper");
    const qrCodeDiv = document.getElementById("qrCodeDiv");
    const qrFooter = document.getElementById("qrFooter");

    qrCodeDiv.innerHTML = "";
    const qrcode = new QRCode(qrCodeDiv);
    qrcode.makeCode(`https://www.simplyanything.ca?room=${roomData.roomCode}`);

    const qrCodeCanvas = qrCodeDiv.querySelector("canvas");
    //qrCodeCanvas.removeAttribute("width");
    //qrCodeCanvas.removeAttribute("height");
    qrCodeCanvas.classList.add("qrCode");

    const qrCodeImg = qrCodeDiv.querySelector("img");
    qrCodeImg.classList.add("qrCode");

    qrFooter.innerHTML = `www.simplyanything.ca/?room=${roomData.roomCode}`;
    setTimeout(() => {
        ShrinkText(qrFooter);
    }, 10);

    qrDivWrapper.style.display = "";
    qrDivWrapper.style.opacity = "1";
}

function ShowLanguage() {
    return;
    const languageWrapper = document.getElementById("footerLanguageWrapper");
    languageWrapper.style.height = `calc(100% + ${languages.length} * 3 * var(--truevh))`;
}

function getCookie(cname) {
    const name = cname + "=";
    const cutCookie = decodeURIComponent(document.cookie).split(';');
    for(let i = 0; i <cutCookie.length; i++) {
      let c = cutCookie[i];
      while (c.charAt(0) == ' ') {
        c = c.substring(1);
      }
      if (c.indexOf(name) == 0) {
        return c.substring(name.length, c.length);
      }
    }
    return null;
}

// Calculate TrueVh now, then ignore any resize for the next 100ms.
// After 100ms calculate TrueVh again (Debouncing) and start to listen for resize again.
function CalculateTrueVh() {
    const existingTrueVh = parseFloat(document.documentElement.style.getPropertyValue("--truevh")) || 0;
    const currentTruevh = window.innerHeight / 100;
    const truevh = Math.max(existingTrueVh, currentTruevh);
    document.documentElement.style.setProperty('--truevh', `${truevh}px`);

    window.onresize = null;
    setTimeout(() => {
        window.onresize = CalculateTrueVh;
        const truevh = window.innerHeight / 100; document.documentElement.style.setProperty('--truevh', `${truevh}px`);
    }, 100);
}

function AddVisibilityEventListener() {
    let hidden, visibilityChange;
    if (typeof document.hidden !== "undefined") {
        hidden = "hidden";
        visibilityChange = "visibilitychange";
    } else if (typeof document.msHidden !== "undefined") {
        hidden = "msHidden";
        visibilityChange = "msvisibilitychange";
    } else if (typeof document.webkitHidden !== "undefined") {
        hidden = "webkitHidden";
        visibilityChange = "webkitvisibilitychange";
    } else { return; }

    document.addEventListener(visibilityChange, function() {
        if (document[hidden]) {
            // Could be more proactive in deactivating inactive players
            console.log("Game hidden");
        } else {
            console.log("Game became visible");
            RejoinGame();
        }
    }, false);
}

function EmojiHash(inputString) {
    let nameAsciiSum = 0;
    const emojiArray = ["🙃", "🤒", "🤕", "🤧", "🥵", "🥶", "🥴", "😵", "🤯", "🤠", "🥳", "🥸", "😎", "🧐", "🥺", "🤬", "😈", "💀", "👺", "👻", "👾", "🤖", "🦾", "👵", "🙆", "🧑‍⚕️", "🧑‍🏫", "🧑‍🌾", "🧑‍💻", "🧑‍✈️", "🧑‍🚒", "👮", "🕵️", "💂", "🥷", "🤴", "👸", "👲", "🤶", "🦸", "🦹", "🧙", "🧚", "🧛", "🧜‍♀️", "🧝", "🧞‍♀️", "🧟", "🧑‍🦼", "🕴️", "🧘", "🎃", "🎩", "😶‍🌫️", "🙈", "🙉", "🙊", "💥", "🦍", "🐩", "🦊", "🐎", "🦄", "🦌", "🐗", "🐫", "🐘", "🦣", "🐻‍❄️", "🐨", "🐼", "🦥", "🦦", "🐓", "🕊️", "🦅", "🐳", "🐡", "🦋", "🥀", "🌵", "🍄", "🦞", "🌈", "⛄", "🎍", "🍉", "🍌", "🍍", "🍑", "🍒", "🥝", "🌶️", "🍖", "🍕", "🌮", "🍿", "🧈", "🍱", "🍩", "🥧", "🍷", "🤺", "🏄", "🏆", "🥋", "🎯", "🗻", "🏝️", "🏩", "🏯", "🗼", "⛩️", "🏍️", "🛸", "🪐", "🗿", "💴", "💔", "💮", "♨", "🀄", "⚠️", "☢️", "🔱", "🉐", "🔞", "🧸", "🧾", "🚽"];
    for (let stringIndex=0; stringIndex < inputString.length; stringIndex++) {
        nameAsciiSum += inputString.charCodeAt(stringIndex);
    }
    return emojiArray[nameAsciiSum%emojiArray.length];
}

function StringTo2ndPerson(questionString) {
    questionString = questionString.replace(/XyoutheyX/g, "you");
    questionString = questionString.replace(/XYoutheyX/g, "You");
    questionString = questionString.replace(/XyouthemX/g, "you");
    questionString = questionString.replace(/XYouthemX/g, "You");
    questionString = questionString.replace(/XyourtheirX/g, "your");
    questionString = questionString.replace(/XYourtheirX/g, "Your");
    return questionString;
}

function StringTo3rdPerson(questionString) {
    questionString = questionString.replace(/XyoutheyX/g, "they");
    questionString = questionString.replace(/XYoutheyX/g, "They");
    questionString = questionString.replace(/XyouthemX/g, "them");
    questionString = questionString.replace(/XYouthemX/g, "Them");
    questionString = questionString.replace(/XyourtheirX/g, "their");
    questionString = questionString.replace(/XYourtheirX/g, "Their");
    questionString = questionString.replace(/\(.*\)/g, "");
    return questionString;
}

function ShrinkText(container, textElement) {
    if(textElement === undefined) { textElement = container; }
    let textAltered = false;
    const originalTransitionRule = textElement.style.transition;
    const originalFontSize = parseFloat(window.getComputedStyle(textElement).fontSize);

    textElement.style.transition = "font-size 0s";
    textElement.style.fontSize = parseFloat(window.getComputedStyle(textElement).fontSize)*1.1 + "px";
    while(container.scrollWidth > container.offsetWidth) {
        textElement.style.fontSize = parseFloat(window.getComputedStyle(textElement).fontSize)*0.98 + "px";
        textAltered = true;
    }
    while(container.scrollHeight > container.offsetHeight) {
        textElement.style.fontSize = parseFloat(window.getComputedStyle(textElement).fontSize)*0.98 + "px";
        textAltered = true;
    }

    if(textAltered) {
        textElement.style.fontSize = parseFloat(window.getComputedStyle(textElement).fontSize)*(1/1.1) + "px";
    } else {
        textElement.style.fontSize = originalFontSize + "px";
    }
    textElement.style.transition = originalTransitionRule;
}
//#endregion