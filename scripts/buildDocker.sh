#!/bin/bash

VERSION=$(jq -r .version ../package.json)
TAG="crazydev71/fabric-rest:$VERSION"
echo "Building $TAG"
docker build -t $TAG --label com.crazydev71.version="$VERSION" ../

