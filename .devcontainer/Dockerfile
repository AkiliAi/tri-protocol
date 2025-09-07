FROM node:18-bullseye

# Installer des outils utiles
RUN apt-get update && apt-get install -y \
    git \
    curl \
    wget \
    nano \
    vim \
    && rm -rf /var/lib/apt/lists/*

# Installer la dernière version de npm
RUN npm install -g npm@latest

# Créer le répertoire de travail
WORKDIR /workspace

# Copier les fichiers de configuration npm
COPY package*.json ./

# Installer les dépendances
RUN npm install

# Exposer les ports pour votre application
EXPOSE 3000 8080