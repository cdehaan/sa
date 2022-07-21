FROM node:16-alpine
WORKDIR /sa
COPY package.json .
RUN npm install
COPY . .