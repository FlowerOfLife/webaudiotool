define([
	'PatchEvent',
	'ModuleCategories',
	'CodeGenerator',
	'ModuleTypes',
	'EventDispatcher',
	'AudioContextManagerEvent',
	'Utils',
	'ModuleDefinitions',
	'AttributeTypes'
], function(
	PatchEvent,
	ModuleCategories,
	CodeGenerator,
	ModuleTypes,
	EventDispatcher,
	AudioContextManagerEvent,
	Utils,
 	ModuleDefinitions,
 	AttributeTypes
){
	AudioContextManager.prototype = Object.create(EventDispatcher.prototype);
	AudioContextManager.prototype.constructor = AudioContextManager;

	function AudioContextManager(patch, audioContext)
	{
		EventDispatcher.call(this);

		this.patch = patch;
		this.logColor = '#FF00FF';
		this.audioContext = audioContext;
		this.patchEventHandler = this.handlePatchEvent.bind(this);

		this.patch.addEventListener(PatchEvent.MODULE_ADDED, this.patchEventHandler);
		this.patch.addEventListener(PatchEvent.MODULE_REMOVED, this.patchEventHandler);
		this.patch.addEventListener(PatchEvent.CONNECTION_ADDED, this.patchEventHandler);
		this.patch.addEventListener(PatchEvent.CONNECTION_PRE_REMOVE, this.patchEventHandler);
		this.patch.addEventListener(PatchEvent.CONNECTION_POST_REMOVE, this.patchEventHandler);
		this.patch.addEventListener(PatchEvent.PATCH_CLEARED, this.patchEventHandler);
		this.patch.addEventListener(PatchEvent.MODULE_ATTRIBUTE_CHANGED, this.patchEventHandler);
	}

	AudioContextManager.prototype.handlePatchEvent = function(type, data)
	{
		switch(type)
		{
			case PatchEvent.MODULE_ADDED:
			{
				var module = data.module;

				switch(module.definition.category)
				{
					case ModuleCategories.NATIVE:
					{
						// call the function with supplied arguments to create the audionode and store it
						var jsMethodName = module.definition.js;
						var audioNode = this.audioContext[jsMethodName].call(this.audioContext, data.args);
						module.setAudioNode(audioNode);
						
						// start if osc TODO methods as buttons?
						if(module.definition.type === 'oscillator') module.audioNode.start();

						// console.log(data.attributes);
						// if(data.attributes)
						// {
						// 	for(var i = 0; i < data.attributes.length; i++)
						// 	{
						// 		var attribute = data.attributes[i];
								
						// 		//console.log(ModuleDefinitions);
						// 		var attributeDefinition = ModuleDefinitions.findAttribute(module.definition.type, attribute.id);
						// 		switch(attributeDefinition.type)
						// 		{
						// 			case AttributeTypes.AUDIO_PARAM:
						// 			{
						// 				break;
						// 			}
						// 			default:
						// 			{
						// 				console.error('Unhandled attribute type: ', attribute);
						// 			}
						// 		}
						// 	}
						// }

						this.dispatchEvent(AudioContextManagerEvent.MODULE_ADDED, {module: module});
						
						break;
					}
					case ModuleCategories.PROXY:
					{
						// do nothing
						break;
					}
					default:
					{
						console.error('Unhandled module category: ' + module.definition.category);
					}
				}
				
				break;
			}
			case PatchEvent.MODULE_REMOVED:
			{
				//this.codeGenerator.addToLiveCode(this.codeGenerator.getStringForModuleRemoved(data.module));	
				//this.dispatchEvent(AudioContextManagerEvent.MODULE_REMOVED, {module: data.module});
				break;
			}
			case PatchEvent.PATCH_CLEARED:
			{
				this.dispatchEvent(AudioContextManagerEvent.PATCH_CLEARED);
				break;
			}
			case PatchEvent.CONNECTION_ADDED:
			{
				this.addApiConnectionFor(data.connection);

				break;
			}
			case PatchEvent.CONNECTION_PRE_REMOVE:
			{
				// get the api connections for this connection
				var apiConnectionsToRemove = data.connection.getApiConnections();

				// we have to clear the source outputs of these api connections
				var outgoingApiConnections = [];
				for(var i = 0; i < apiConnectionsToRemove.length; i++)
				{
					var apiConnectionToRemove = apiConnectionsToRemove[i];

					// get all outgoing connections for the source modules+outputs of these connections
					var sourceModuleToClear = apiConnectionToRemove.sourceModule;
					var outgoingConnections = sourceModuleToClear.getOutgoingConnectionsForOutput(apiConnectionToRemove.sourceOutputIndex);

					// get all the api connections for these connections
					for(var j = 0; j < outgoingConnections.length; j++)
					{
						var outgoingApiConnectionsToAdd = outgoingConnections[j].getApiConnections();

						// loop through them so we can check if we havent already added each of them
						for(var k = 0; k < outgoingApiConnectionsToAdd.length; k++)
						{
							if(!Utils.connectionIsInList(outgoingApiConnectionsToAdd[k], outgoingApiConnections))
							{
								outgoingApiConnections.push(outgoingApiConnectionsToAdd[k]);	
							}	
						}
						
						
					}

				}

				// we now have a list of the outgoing api connections, which should include the ones to remove
				// make a new list without the ones we want to remove (which is the list of connections we need to restore)
				var apiConnectionsToRestore = [];

				// loop through all connections
				for(var i = 0; i < outgoingApiConnections.length; i++)
				{
					// and for each connection, see if it exists in the apiconnections to remove
					if(!Utils.connectionIsInList(outgoingApiConnections[i], apiConnectionsToRemove))
					{
						apiConnectionsToRestore.push(outgoingApiConnections[i]);	
					}
				}

				// now that we know what to remove and to restore, disconnect all source modules.
				// note that disconnecting disregards the destination (+destinput), so chances are that there are
				// multiple disconnects done on the same source+sourceouput (with different destinations)
				// so we need to keep track of what we already disconnected to avoid doing unneccessary disconnect on the 
				// same source+output
				var removed = [];
				for(var i = 0; i < apiConnectionsToRemove.length; i++)
				{
					var removeConnection = apiConnectionsToRemove[i];

					if(!Utils.connectionIsInList(removeConnection, removed, true))
					{
						removeConnection.sourceModule.audioNode.disconnect(removeConnection.sourceOutputIndex);

						this.dispatchEvent(AudioContextManagerEvent.OUTPUT_DISCONNECTED, {
							module: removeConnection.sourceModule,
							outputIndex: removeConnection.sourceOutputIndex
						});

						removed.push(removeConnection);
					}
					
				}

				// and restore connections
				for(var i = 0; i < apiConnectionsToRestore.length; i++)
				{
					this.addApiConnectionFor(apiConnectionsToRestore[i]);
				}
					
				break;
			}
			case PatchEvent.MODULE_ATTRIBUTE_CHANGED:
			case PatchEvent.CONNECTION_POST_REMOVE:
			{
				// does nothing
				break;
			}
			default:
			{
				console.warn('Unhandled patch event: ' + type);
			}
		}
	}
	
	AudioContextManager.prototype.addApiConnectionFor = function(connection)
	{
		var apiConnections = connection.getApiConnections();
				
		// connect all sources with all destinations
		for(var i = 0; i < apiConnections.length; i++)
		{
			var connection = apiConnections[i];

			// -1 means it's an output module in the rootpatch, in that case we have to connect to the destination
			if(connection.destinationInputIndex === -1)
			{
				connection.sourceModule.audioNode.connect(this.audioContext.destination, connection.sourceOutputIndex);
			}
			else
			{
				// check if the destination input represents an audioparam
				var audioParam = connection.destinationModule.getAudioParamForInputIndex(connection.destinationInputIndex);
				if(audioParam)
				{
					connection.sourceModule.audioNode.connect(connection.destinationModule.audioNode[audioParam.id], connection.sourceOutputIndex);
					
				}
				else
				{
					// connection to regular input
					connection.sourceModule.audioNode.connect(connection.destinationModule.audioNode, connection.sourceOutputIndex, connection.destinationInputIndex);	
				}
				
			}
			

			this.dispatchEvent(AudioContextManagerEvent.CONNECTION_ADDED, {connection: connection});	
		}
	}

	return AudioContextManager;

});